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
