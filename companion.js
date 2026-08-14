// Компаньон-процесс: работает рядом с `claude --channels` в том же контейнере,
// не трогает и не блокирует сам процесс Claude Code (у нас нет доступа к его
// внутреннему pty, чтобы перехватывать ответы до отправки — Telegram-плагин
// это чёрный ящик). Поэтому проверки постфактум: читает JSONL-транскрипт
// сессии с диска и отдаёт сводку по HTTP дирижёру (super_bot.py) на другом
// Railway-проекте.
//
// Зачем отдельный процесс, а не логика внутри самого Claude Code: у Ашет нет
// эквивалента interaction_log/tech_supervisor с платформы — это тот же
// контроль, но постфактум, единственный технически доступный вариант в
// архитектуре Channels.
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.COMPANION_PORT || 8787;
const SECRET = process.env.COMPANION_SECRET || '';
const PROJECTS_DIR = '/data/claude-home/projects/-app';

// Тот же список "чужих" алфавитных диапазонов, что в text_quality.py на платформе —
// see /Users/andrejorlov/Documents/my-project/neurostaff/text_quality.py
const FOREIGN_SCRIPT = new RegExp(
  '[㐀-鿿豈-﫿' + // CJK ideographs
  '぀-ヿ' +               // hiragana/katakana
  '가-힣' +               // hangul
  '฀-๿' +               // thai
  'À-ÖØ-öø-ÿĀ-ɏ' + // latin + diacritics
  'Ạ-ỹ' +               // vietnamese-only diacritics
  '؀-ۿ' +               // arabic
  'ऀ-ॿ]',               // devanagari (+u flag — иначе суррогаты эмодзи матчатся как CJK)
  'u'
);

// 06.08.2026: в проде поймали обрубок «stagram «еду на серф😎», video) я отправ»
// по алярту FOREIGN_SCRIPT, но суть бага другая — LLM начала в prose описывать
// параметры publish_request и стрим оборвался на полуслове. FOREIGN_SCRIPT тут
// сработал на невидимый в UI символ, а снаружи выглядит как truncation. Поэтому
// добавили второй детектор — портирован 1-в-1 из text_quality.py в neurostaff,
// см. has_unfinished_structure(). Логика: незакрытые скобки снаружи ```кода```
// + словарик параметров (instagram:, video: …) + отсутствие терминала в хвосте.
// Не сработает на нормальном «сходи в (например, пятницу)».
const OPENERS = '({[';
const CLOSERS = ')}]';
const TERMINAL_TAIL = new Set(['.', '!', '?', '…', '»', ')', ']', '}', '\n', '"', '*']);
const TRIGGER_HINT = /(?:instagram|telegram|video|image|reel|story|media|platform|content_type|caption|publish|post|file|path|url)\s*[:=]/i;
const CODE_BLOCK = /```.*?```/gs;

function sliceSnippet(text, idx) {
  const start = Math.max(0, idx - 20);
  const end = Math.min(text.length, idx + 20);
  return text.slice(start, end);
}

function detectUnfinishedStructure(text) {
  if (!text) return null;
  const clean = text.replace(CODE_BLOCK, '');
  if (!clean) return null;

  const balance = { '(': 0, '{': 0, '[': 0 };
  for (const ch of clean) {
    if (ch in balance) {
      balance[ch]++;
    } else if (CLOSERS.includes(ch)) {
      const idx = CLOSERS.indexOf(ch);
      const opener = OPENERS[idx];
      if (balance[opener] > 0) {
        balance[opener]--;
      } else {
        // Клозер без опенеров — явно мусор («})}» в проде).
        return sliceSnippet(clean, clean.indexOf(ch));
      }
    }
  }

  if (Math.max(...Object.values(balance)) < 1) return null;
  if (!TRIGGER_HINT.test(clean)) return null;

  const stripped = clean.replace(/\s+$/, '');
  if (stripped && TERMINAL_TAIL.has(stripped[stripped.length - 1])) return null;

  for (let i = 0; i < clean.length; i++) {
    if (OPENERS.includes(clean[i])) return sliceSnippet(clean, i);
  }
  return sliceSnippet(clean, 0);
}

function findLatestTranscript() {
  const files = fs.readdirSync(PROJECTS_DIR)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => {
      const p = path.join(PROJECTS_DIR, f);
      return { p, mtime: fs.statSync(p).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return files.length ? files[0].p : null;
}

function analyze(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  let inTok = 0, outTok = 0, cacheCreate = 0, cacheRead = 0, turns = 0;
  let first = null, last = null;
  const contamination = [];

  for (const line of lines) {
    let o;
    try { o = JSON.parse(line); } catch (e) { continue; }

    if (o.timestamp) {
      if (!first) first = o.timestamp;
      last = o.timestamp;
    }

    if (o.message && o.message.usage) {
      const u = o.message.usage;
      inTok += u.input_tokens || 0;
      outTok += u.output_tokens || 0;
      cacheCreate += u.cache_creation_input_tokens || 0;
      cacheRead += u.cache_read_input_tokens || 0;
      turns++;
    }

    if (o.message && Array.isArray(o.message.content)) {
      for (const block of o.message.content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          let detected = null;
          const m = FOREIGN_SCRIPT.exec(block.text);
          if (m) {
            detected = { kind: 'foreign_script', snippet: sliceSnippet(block.text, m.index) };
          } else {
            const unfinished = detectUnfinishedStructure(block.text);
            if (unfinished) {
              detected = { kind: 'unfinished_structure', snippet: unfinished };
            }
          }
          if (detected) {
            contamination.push({
              timestamp: o.timestamp || null,
              kind: detected.kind,
              snippet: detected.snippet,
            });
          }
        }
      }
    }
  }

  return {
    file: path.basename(filePath),
    turns, input_tokens: inTok, output_tokens: outTok,
    cache_creation_input_tokens: cacheCreate, cache_read_input_tokens: cacheRead,
    first_turn: first, last_turn: last,
    contamination_incidents: contamination,
    ...detectAuthExpired(lines),
  };
}

// OAuth-сессия Claude Code (посеяна из Keychain владельца подписки, см.
// capability_claude_code_channels_deploy.md) истекает без предупреждения —
// найдено вживую 16.07.2026 на Амине: claude отвечает канонической строкой
// "Not logged in · Please run /login" вместо реальной обработки сообщения,
// и клиент получает тишину/заглушку вместо ответа. Это не порча текста
// (другой детектор выше) — сессия вообще не может думать, а не просто плохо
// думает. Смотрим ИМЕННО последнюю assistant-реплику в файле: если сессия
// уже почикнена свежим токеном, новые реплики после реseed перезапишут
// "последнюю" и флаг сам погаснет — не нужно чистить историю вручную.
const AUTH_EXPIRED_RE = /Not logged in|Please run\s*\/login/i;

function detectAuthExpired(lines) {
  let lastAssistantText = null;
  for (const line of lines) {
    let o;
    try { o = JSON.parse(line); } catch (e) { continue; }
    if (!o.message || o.message.role !== 'assistant') continue;
    let text = '';
    if (typeof o.message.content === 'string') {
      text = o.message.content;
    } else if (Array.isArray(o.message.content)) {
      text = o.message.content
        .filter(b => b.type === 'text' && typeof b.text === 'string')
        .map(b => b.text)
        .join('\n');
    }
    if (text.trim()) lastAssistantText = text.trim();
  }
  const expired = !!(lastAssistantText && AUTH_EXPIRED_RE.test(lastAssistantText));
  return { auth_expired: expired, auth_expired_snippet: expired ? lastAssistantText.slice(0, 200) : null };
}

// Извлекает текстовые реплики (для суммаризации уровня 2 памяти на дирижёре) —
// в отличие от analyze(), который считает только токены/порчу текста, здесь
// нужен сам текст user/assistant, отфильтрованный по timestamp > since.
function getTurns(filePath, since) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  const turns = [];

  for (const line of lines) {
    let o;
    try { o = JSON.parse(line); } catch (e) { continue; }

    if (!o.timestamp || (since && o.timestamp <= since)) continue;
    const role = o.message && o.message.role;
    if (role !== 'user' && role !== 'assistant') continue;

    let text = '';
    if (typeof o.message.content === 'string') {
      text = o.message.content;
    } else if (Array.isArray(o.message.content)) {
      text = o.message.content
        .filter(b => b.type === 'text' && typeof b.text === 'string')
        .map(b => b.text)
        .join('\n');
    }
    text = text.trim();
    if (!text) continue;

    turns.push({ timestamp: o.timestamp, role, text });
  }
  return turns;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (!SECRET || req.headers['x-companion-secret'] !== SECRET) {
    res.writeHead(401); res.end(); return;
  }

  if (url.pathname === '/turns') {
    try {
      const file = findLatestTranscript();
      if (!file) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, no_session_yet: true, turns: [] }));
        return;
      }
      const since = url.searchParams.get('since') || '';
      const turns = getTurns(file, since);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, turns }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return;
  }

  // Админ: посмотреть текущий allowlist + pending (для онбординга: узнать user_id
  // нового пользователя из pending.<code>, который тот получил при /start).
  if (url.pathname === '/admin/allowlist' && req.method === 'GET') {
    try {
      // Ищем access.json по нескольким правдоподобным путям — раньше я заложил
      // /plugins/, но в проде у Ашет он лежит в /channels/, надо сканировать.
      const candidates = [
        '/data/claude-home/channels/telegram/access.json',
        '/data/.claude/plugins/telegram/access.json',
        '/data/.claude/channels/telegram/access.json',
        '/data/.claude/telegram/access.json',
        '/data/claude/plugins/telegram/access.json',
        '/data/claude/channels/telegram/access.json',
      ];
      let foundPath = null;
      for (const p of candidates) {
        if (fs.existsSync(p)) { foundPath = p; break; }
      }
      if (!foundPath) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, access_exists: false, tried: candidates }));
        return;
      }
      const raw = fs.readFileSync(foundPath, 'utf8');
      const data = JSON.parse(raw);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        path: foundPath,
        dmPolicy: data.dmPolicy || null,
        allowFrom: Array.isArray(data.allowFrom) ? data.allowFrom : [],
        pending: data.pending && typeof data.pending === 'object' ? data.pending : {},
      }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return;
  }

  // Админ: добавить user_id в allowlist. По умолчанию закрывает pairing
  // (dmPolicy → allowlist) и удаляет все pending-записи для этого user_id.
  // Без SSH/Dashboard — единственный путь добавить оператора в продакшен-бот.
  if (url.pathname === '/admin/allowlist/add' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const userId = String(payload.user_id || '');
        if (!userId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'user_id required' }));
          return;
        }
        const candidates = [
          '/data/claude-home/channels/telegram/access.json',
          '/data/.claude/plugins/telegram/access.json',
          '/data/.claude/channels/telegram/access.json',
          '/data/.claude/telegram/access.json',
          '/data/claude/plugins/telegram/access.json',
          '/data/claude/channels/telegram/access.json',
        ];
        let accessPath = null;
        for (const p of candidates) {
          if (fs.existsSync(p)) { accessPath = p; break; }
        }
        if (!accessPath) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'access.json not found', tried: candidates }));
          return;
        }
        const data = JSON.parse(fs.readFileSync(accessPath, 'utf8'));

        if (!Array.isArray(data.allowFrom)) data.allowFrom = [];
        if (!data.pending || typeof data.pending !== 'object') data.pending = {};

        if (!data.allowFrom.includes(userId)) {
          data.allowFrom.push(userId);
        }

        // Чистим все pending-записи для этого user_id. Поле в реальном access.json
        // называется "senderId" (а не "user_id" — раньше был баг и проверка не
        // матчилась, из-за чего pending-код оставался и плагин слал pairing-промпт
        // даже после добавления в allowlist). Также удаляем по chatId на случай
        // если имя поля когда-то поменяют.
        for (const code of Object.keys(data.pending)) {
          const p = data.pending[code];
          if (!p) continue;
          if (String(p.senderId) === userId || String(p.user_id) === userId || String(p.chatId) === userId) {
            delete data.pending[code];
          }
        }

        // По умолчанию закрываем pairing → allowlist
        if (payload.close_pairing !== false) {
          data.dmPolicy = 'allowlist';
        }

        // Атомарная запись через временный файл + rename
        const tmpPath = accessPath + '.tmp';
        fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
        fs.renameSync(tmpPath, accessPath);

        // Создаём approved/<userId> с chatId — плагин опрашивает эту директорию,
        // чтобы слать "you're in" и пускать сообщения в Claude-сессию. Без файла
        // доступ на уровне allowFrom не активируется.
        const approvedDir = path.join(path.dirname(accessPath), 'approved');
        try { fs.mkdirSync(approvedDir, { recursive: true }); } catch (e) {}
        const chatIdFromPending = (() => {
          for (const code of Object.keys(data.pending)) {
            const p = data.pending[code];
            if (p && String(p.senderId) === userId) return p.chatId;
          }
          // Если pending нет — попробуем взять chatId из payload, если клиент его передал
          return payload.chat_id ? String(payload.chat_id) : userId;
        })();
        try {
          fs.writeFileSync(path.join(approvedDir, userId), String(chatIdFromPending));
        } catch (e) { /* не критично — основная задача (allowFrom+pending) уже сделана */ }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          path: accessPath,
          approved: path.join(approvedDir, userId),
          approvedWritten: chatIdFromPending,
          allowFrom: data.allowFrom,
          dmPolicy: data.dmPolicy,
          pending_remaining: Object.keys(data.pending).length,
        }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e) }));
      }
    });
    return;
  }

  // Админ: ping-тест — отправляет сообщение в Telegram через bot token, чтобы
  // проверить что (а) бот жив, (б) chat_id валидный, (в) бот и пользователь
  // действительно могут общаться. Используется при онбординге: пнул — юзер
  // ответил — значит access.json подхвачен. body: {chat_id, text}
  if (url.pathname === '/admin/ping' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const chatId = String(payload.chat_id || '');
        const text = String(payload.text || 'ping from companion');
        if (!chatId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'chat_id required' }));
          return;
        }
        const token = process.env.TELEGRAM_BOT_TOKEN || '';
        if (!token) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'TELEGRAM_BOT_TOKEN not set' }));
          return;
        }
        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        const tgBody = JSON.stringify({ chat_id: chatId, text });
        const req2 = https.request(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(tgBody) },
        }, (r2) => {
          let d2 = '';
          r2.on('data', (c) => { d2 += c; });
          r2.on('end', () => {
            res.writeHead(r2.statusCode, { 'Content-Type': 'application/json' });
            res.end(d2);
          });
        });
        req2.on('error', (e) => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: String(e) }));
        });
        req2.write(tgBody);
        req2.end();
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e) }));
      }
    });
    return;
  }

  // Админ: рекурсивный скан /data/.claude/ чтобы найти где реально лежит access.json
  // (Telegram-плагин может использовать путь, который я не угадал в candidates).
  // Защищён COMPANION_SECRET — только для отладки онбординга.
  if (url.pathname === '/admin/fs' && req.method === 'GET') {
    try {
      const base = url.searchParams.get('base') || '/data/.claude';
      const maxDepth = parseInt(url.searchParams.get('depth') || '3', 10);
      const out = [];
      function walk(dir, depth) {
        if (depth > maxDepth) return;
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch (e) { return; }
        for (const ent of entries) {
          const p = path.join(dir, ent.name);
          if (ent.isDirectory()) {
            out.push({ type: 'dir', path: p });
            walk(p, depth + 1);
          } else if (ent.isFile()) {
            out.push({ type: 'file', path: p, size: ent.size || 0 });
          }
        }
      }
      walk(base, 0);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, base, depth: maxDepth, entries: out }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return;
  }

  // Админ: stat — прямая проверка одного пути через fs.statSync (readdirSync
  // в /admin/fs молча глотает EACCES, не видно реальной причины пустого листинга).
  // Также пробует создать файл и сразу его прочитать — для диагностики
  // approved/<userId>, куда Telegram-плагин пишет маркер "you're in".
  if (url.pathname === '/admin/stat' && req.method === 'GET') {
    try {
      const target = url.searchParams.get('path') || '';
      if (!target) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'path required' }));
        return;
      }
      const out = { ok: true, path: target };
      try {
        const st = fs.statSync(target);
        out.exists = true;
        out.isFile = st.isFile();
        out.isDirectory = st.isDirectory();
        out.size = st.size;
        out.mode = st.mode;
        out.uid = st.uid;
        out.gid = st.gid;
        if (st.isFile() && st.size < 1024) {
          try { out.content = fs.readFileSync(target, 'utf8'); } catch (e) { out.contentError = String(e); }
        }
      } catch (e) {
        out.exists = false;
        out.statError = String(e);
        out.statCode = e.code;
      }
      // Также листинг родителя — чтобы понять, видим ли мы там вообще файлы
      const parent = path.dirname(target);
      try {
        const list = fs.readdirSync(parent);
        out.parentListing = list;
      } catch (e) {
        out.parentListingError = String(e);
        out.parentListingCode = e.code;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return;
  }

  // Админ: touch — пишет маркерный файл по указанному пути и сразу его читает,
  // возвращая success/failure. Для диагностики approved/<userId>.
  if (url.pathname === '/admin/touch' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const target = String(payload.path || '');
        const content = String(payload.content || '');
        if (!target) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'path required' }));
          return;
        }
        const out = { ok: true, path: target };
        try { fs.mkdirSync(path.dirname(target), { recursive: true }); out.mkdirOk = true; }
        catch (e) { out.mkdirError = String(e); out.mkdirCode = e.code; }
        try { fs.writeFileSync(target, content); out.writeOk = true; }
        catch (e) { out.writeError = String(e); out.writeCode = e.code; }
        try { out.readBack = fs.readFileSync(target, 'utf8'); }
        catch (e) { out.readError = String(e); out.readCode = e.code; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e) }));
      }
    });
    return;
  }

  if (url.pathname !== '/status') {
    res.writeHead(404); res.end(); return;
  }
  try {
    const file = findLatestTranscript();
    if (!file) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, no_session_yet: true }));
      return;
    }
    const data = analyze(file);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ...data }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: String(e) }));
  }
});

server.listen(PORT, () => {
  console.log(`[companion] слушаю :${PORT}, читаю транскрипты из ${PROJECTS_DIR}`);
});
