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

// 17.08.2026 v2: /delivery — извлекает факты Telegram delivery из JSONL.
//
// ЧТО ИСТИННО ПО ПЛАГИНУ: единственная точка отправки пользователю —
// bot.api.sendMessage(...) внутри MCP tool 'reply' (см. server.ts:563
// плагина claude-plugins-official/telegram/0.0.7). При успехе tool_result
// содержит "sent (id: N)" / "sent N parts (ids: ...)" — это ДОКАЗАТЕЛЬСТВО
// доставки (Telegram Bot API вернул message_id). При ошибке — is_error=true
// или "reply failed after ...". Плагин НЕ отправляет plain assistant text
// автоматически (см. plugin instructions: "transcript output never reaches
// their chat"). Если в реальном JSONL видим assistant text без tool reply
// (включая случаи, когда перед текстом были WebFetch/Read/Bash/Search — это
// НЕ доставка) — фиксируем как assistant_plain_text_no_reply, а НЕ как
// delivered и НЕ шлём fallback-текст (чтобы не дублировать, если Anthropic
// в будущем введёт auto-send).
//
// ЧТО ЭТА ФУНКЦИЯ ДЕЛАЕТ: парсит JSONL построчно и эмитит СОБЫТИЯ:
//   - type='inbound'              — новое входящее от Telegram
//   - type='reply_started'        — плагин вызвал tool 'reply'
//   - type='delivered'            — tool_result: sent (id: N) (Telegram подтвердил)
//   - type='failed'               — tool_result: isError или "reply failed after"
//   - type='assistant_plain_text_no_reply' — assistant text БЕЗ tool reply call
//     (но возможно С другими tool_use: WebFetch/Read/Bash/Search — это НЕ доставка)
//
// SCOPE (18.08.2026 v3.1):
//   - 'scoped'   — сессия содержит ровно 1 chat_id → incident привязан к этому чату
//   - 'unscoped' — сессия содержит 0 или ≥2 chat_id → incident НЕ имеет chat_id,
//     НЕ показывает кнопку ручной доставки клиенту (риск отправки не тому)
//   Решение принимается на уровне СЕССИИ, а не отдельного turn — даже если
//   plain text синтаксически после inbound от chat A, при наличии chat B
//   в той же JSONL-сессии атрибуция неоднозначна.
//
// Идемпотентность: super_bot.py использует (bot_slug, chat_id, inbound_message_id)
// как UNIQUE ключ для scoped → повторный poll = UPSERT, не дубликат.
// Для unscoped — отдельная таблица (см. migration_27).
//
// Идемпотентность: super_bot.py использует (bot_slug, chat_id, inbound_message_id)
// как UNIQUE ключ → повторный poll = UPSERT, не дубликат.
//
// Source string в JSONL: бывает два формата (плагин 0.0.7 + новые версии CC):
//   <channel source="telegram" chat_id="..." message_id="...">             ← старый
//   <channel source="plugin:telegram:telegram" chat_id="..." message_id="..."> ← новый
// Регекс ниже ловит ОБА.
//
// inbound_message_id NOT NULL: если не распарсился — caller в super_bot
// должен пометить invalid-маркером и заалертить, НЕ объединять.
//
// Безопасность:
//   - В логи НЕ попадают токены.
//   - response_text — это текст бота (исходящий). НЕ пользовательский.
function getDeliveries(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  // v3.1.1: session_id = basename of JSONL file (стабильный идентификатор
  // транскрипта, не зависит от poll count). Используется в incident_key для
  // идемпотентности UNSCOPED incidents (Блокер 2): повторный poll тех же
  // JSONL-событий → тот же session_id → тот же incident_key → ON CONFLICT
  // DO NOTHING. Два разных violating turn → разные assistant_ts → разные
  // ключи.
  const sessionId = filePath.split('/').pop();

  // Проход 1: собираем все блоки в индексированные структуры.
  const inboundsByChatId = new Map();    // chat_id -> [{ts, message_id}]
  const replyToolUseById = new Map();    // tool_use_id -> {ts, chat_id, reply_to, text}
  const replyToolResultById = new Map(); // tool_use_id -> {ts, is_error, content_text}
  const assistantTurns = [];             // [{ts, has_text, has_tool_use, snapshot_of_lastInbound}]
  let lastInboundPerChat = new Map();    // chat_id -> message_id (для матча assistant text)

  for (const line of lines) {
    let o; try { o = JSON.parse(line); } catch (e) { continue; }
    const ts = o.timestamp;
    if (!ts) continue;
    const isUser = o.type === 'user' || (o.message && o.message.role === 'user');
    const isAssistant = o.type === 'assistant' || (o.message && o.message.role === 'assistant');
    const content = (o.message && Array.isArray(o.message.content)) ? o.message.content : [];

    if (isUser && content.length) {
      for (const block of content) {
        // 1. Парсим <channel ...> блок (ТОЛЬКО в user, не в assistant).
        if (block.type === 'text' && typeof block.text === 'string') {
          // Два формата source: "telegram" или "plugin:telegram:telegram"
          const meta = block.text.match(
            /<channel\s+source="(?:plugin:telegram:)?telegram"[^>]*chat_id="([^"]+)"[^>]*\bmessage_id="([^"]+)"/
          );
          if (meta) {
            const chatId = meta[1];
            const messageId = meta[2];
            if (!inboundsByChatId.has(chatId)) inboundsByChatId.set(chatId, []);
            inboundsByChatId.get(chatId).push({ ts, message_id: messageId });
            lastInboundPerChat.set(chatId, messageId);
            continue;
          }
        }
        // 2. tool_result в user-сообщении (это ответ Claude на tool call).
        if (block.type === 'tool_result' && block.tool_use_id) {
          let contentText = '';
          if (Array.isArray(block.content)) {
            contentText = block.content
              .filter(b => b && b.type === 'text' && typeof b.text === 'string')
              .map(b => b.text)
              .join('\n');
          } else if (typeof block.content === 'string') {
            contentText = block.content;
          }
          replyToolResultById.set(block.tool_use_id, {
            ts,
            is_error: !!block.is_error,
            content_text: contentText,
          });
        }
      }
    }

    if (isAssistant && content.length) {
      let hasText = false;
      let hasReplyToolUse = false;       // v3.1: split tool_use на reply vs non-reply
      let hasNonReplyToolUse = false;
      let textParts = [];  // v3.1: полный plain assistant text (без truncation)
      for (const block of content) {
        if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
          hasText = true;
          textParts.push(block.text);
        }
        if (block.type === 'tool_use' && block.id) {
          if (block.name === 'reply') {
            const input = block.input || {};
            replyToolUseById.set(block.id, {
              ts,
              chat_id: input.chat_id ? String(input.chat_id) : null,
              reply_to: input.reply_to ? String(input.reply_to) : null,
              text: typeof input.text === 'string' ? input.text : '',
            });
            hasReplyToolUse = true;
          } else {
            // WebFetch, Bash, Read, Search и любые другие — это НЕ доставка.
            // turn с такими tools всё равно считается "нарушением контракта",
            // если в нём есть text И НЕТ reply tool_use.
            hasNonReplyToolUse = true;
          }
        }
      }
      assistantTurns.push({
        ts,
        has_text: hasText,
        has_reply_tool_use: hasReplyToolUse,
        has_non_reply_tool_use: hasNonReplyToolUse,
        // v3.1: ПОЛНЫЙ plain text, без slice — будем хранить в отдельной
        // колонке response_text в outbox (НЕ в last_error и НЕ в логах).
        response_text: textParts.join('\n'),
        // Снимок lastInboundPerChat на момент этого turn (для causal inference).
        snapshot: new Map(lastInboundPerChat),
      });
    }
  }

  // Проход 2: формируем массив событий.
  const events = [];

  // 2.1. Inbound-события: для каждого user-сообщения emit 'inbound' (даже если
  // на него ещё не ответили). Гарантирует pending-запись в outbox.
  for (const [chatId, inbounds] of inboundsByChatId.entries()) {
    for (const inc of inbounds) {
      events.push({
        type: 'inbound',
        chat_id: chatId,
        inbound_message_id: inc.message_id,
        received_at: inc.ts,
      });
    }
  }

  // 2.2. Reply tool events: для каждой пары tool_use+tool_result.
  //
  // Причинное сопоставление reply → inbound (повторный review, 18.08.2026):
  //   - если reply_to указан → использовать ТОЛЬКО его (НЕ fallback на последний);
  //   - если reply_to НЕТ → выбирать последнее inbound этого chat_id с
  //     timestamp <= tool_call_ts (НЕ позже!);
  //   - если такого inbound нет → НЕ создавать scoped delivery event,
  //     а эмитить unscoped diagnostic incident БЕЗ кнопки доставки.
  //   - НИКОГДА не привязывать reply к inbound, пришедшему ПОСЛЕ tool_call_ts.
  //
  // Зачем: иначе reply tool мог "связаться" с более поздним сообщением
  // клиента, и incident на тот поздний inbound остался бы невидимым.
  for (const [toolUseId, use] of replyToolUseById.entries()) {
    if (!use.chat_id) continue;  // Без chat_id не имеем права создавать запись.
    const result = replyToolResultById.get(toolUseId);
    const inbounds = inboundsByChatId.get(use.chat_id) || [];

    // Найдём inbound_messageId причинно связанный с этим reply.
    let inboundMessageId = null;
    let receivedAt = null;
    let matchedCausally = false;

    if (use.reply_to) {
      // Явный reply_to — единственный источник истины. Никакого fallback.
      const m = inbounds.find(i => i.message_id === use.reply_to);
      if (m && m.ts <= use.ts) {
        inboundMessageId = m.message_id;
        receivedAt = m.ts;
        matchedCausally = true;
      }
      // Если reply_to указан, но inbound пришёл ПОСЛЕ tool_call_ts (или не
      // существует) — это нарушение причинности → НЕ создаём scoped event.
    } else {
      // Нет reply_to → последнее inbound этого chat_id с ts <= tool_call_ts.
      let candidate = null;
      for (const inc of inbounds) {
        if (inc.ts <= use.ts) {
          if (!candidate || inc.ts > candidate.ts) candidate = inc;
        }
      }
      if (candidate) {
        inboundMessageId = candidate.message_id;
        receivedAt = candidate.ts;
        matchedCausally = true;
      }
      // Иначе (нет inbound до tool_call_ts) → unscoped diagnostic.
    }

    if (!matchedCausally) {
      // Diagnostic incident: reply tool без причинно-связанного inbound.
      // НЕ создаём scoped delivery event (НЕТ chat_id→inbound привязки,
      // которую можно записать в UNIQUE-таблицу delivery_outbox_v2).
      // Эмитим diagnostic event с reason='no_causal_inbound'.
      events.push({
        type: 'assistant_no_causal_inbound',
        scope: 'unscoped',
        chat_id: use.chat_id,
        inbound_message_id: null,
        assistant_ts: use.ts,
        response_text: use.text || '',
        reason: 'no_causal_inbound',
        multi_chat: false,
        session_chat_count: inboundsByChatId.size,
        session_id: sessionId,
        // v3.1.1: чтобы супервизор мог показать tool_use_id для отладки.
        tool_use_id: toolUseId,
      });
      continue;
    }

    // reply_started всегда эмитим (создаёт/обновляет запись на status=generating).
    events.push({
      type: 'reply_started',
      chat_id: use.chat_id,
      inbound_message_id: inboundMessageId,
      received_at: receivedAt,
      tool_call_ts: use.ts,
      response_text: use.text || '',
    });

    if (result) {
      const txt = result.content_text || '';
      const m = txt.match(/sent\s+(?:\d+\s+parts\s+)?\(ids?:\s*([^)]+)\)/i);
      const isNumericIds = m && m[1].split(',').every(s => /^\d+\s*$/.test(s.trim()));
      if (!result.is_error && isNumericIds) {
        const ids = m[1].split(',').map(s => s.trim());
        events.push({
          type: 'delivered',
          chat_id: use.chat_id,
          inbound_message_id: inboundMessageId,
          tool_result_ts: result.ts,
          outbound_message_ids: ids,
          response_text: use.text || '',
        });
      } else {
        events.push({
          type: 'failed',
          chat_id: use.chat_id,
          inbound_message_id: inboundMessageId,
          tool_result_ts: result.ts,
          last_error: (txt || (result.is_error ? 'reply tool isError=true' : 'unknown')).slice(0, 500),
          response_text: use.text || '',
        });
      }
    }
    // Если result === null, reply_started уже эмитнут; супервизор увидит
    // status=delivering по timeout.
  }

  // 2.3. v3.1: assistant-text БЕЗ tool reply = violation of contract,
  // НЕЗАВИСИМО от других tools в turn (WebFetch/Read/Bash/Search —
  // это НЕ доставка, они не отправляют текст в Telegram).
  //
  // Правило: turn нарушает контракт, если has_text && !has_reply_tool_use.
  // Любые non-reply tools в turn не отменяют нарушение.
  //
  // Плагин v0.0.7 не делает auto-send для plain text (доказано в
  // /tmp/delivery_outbox_v3_DIAGNOSTIC_REPORT.md, HIGH 90%). Значит, такой
  // текст НЕ дойдёт до пользователя Telegram, и нужно зафиксировать это
  // как incident — а НЕ считать доставленным и НЕ слать fallback-текст
  // (чтобы не дублировать, если в реальности auto-send в будущем появится).
  //
  // SCOPE (session-level):
  //   - session.chatCount === 1 → 'scoped' к этому чату
  //   - session.chatCount === 0 или ≥2 → 'unscoped' (БЕЗ chat_id, БЕЗ delivery кнопки)
  // Решение принимается на уровне ВСЕЙ сессии, а не отдельного turn — даже
  // если plain text синтаксически после inbound от chat A, при наличии
  // chat B в той же JSONL-сессии атрибуция неоднозначна → unscoped.
  //
  // Для UNSCOPED эмитим РОВНО ОДИН event на сессию (даже если несколько
  // plain-text turn'ов) — никакого false multi-chat incident.
  // Для SCOPED — один event на (chat_id, inbound_message_id).
  const sessionChatCount = inboundsByChatId.size;
  const sessionChatIds = Array.from(inboundsByChatId.keys());
  const isMultiChatSession = sessionChatCount >= 2;

  if (isMultiChatSession || sessionChatCount === 0) {
    // Unscoped: per-turn проверка. Каждый violating turn оценивается
    // НЕЗАВИСИМО по своему snapshot.lastInboundPerChat — был ли тот inbound,
    // на который этот turn ОТВЕЧАЕТ, доставлен?
    //
    // "Отвечает на" = самый последний inbound по timestamp в snapshot этого
    // turn. (Если в snapshot только один chat — берём его; если несколько —
    // берём тот, чей inbound_ts самый поздний.)
    //
    // Повторный review (18.08.2026): для КАЖДОГО violating turn эмитим
    // ОТДЕЛЬНЫЙ event со своим assistant_ts и response_text. Каждый event
    // получает уникальный incident_key в super_bot через (bot_slug, session_id,
    // assistant_ts, sha256(response_text)) — повторный poll не дублирует,
    // разные turn'ы → разные incidents.
    //
    // Контрпример: в multi-chat сессии два plain-text turn'а (утром и
    // вечером) → ДВА unscoped events → ДВА incidents в DB.
    for (const t of assistantTurns) {
      if (!(t.has_text && !t.has_reply_tool_use)) continue;
      // Самое свежее inbound в snapshot (по ts).
      let currentChatId = null, currentInboundId = null, currentTs = '';
      for (const [chatId, inboundId] of t.snapshot.entries()) {
        // Ищем ts для этого inboundId в inboundsByChatId.
        const incs = inboundsByChatId.get(chatId) || [];
        const inc = incs.find(i => i.message_id === inboundId);
        const incTs = inc ? inc.ts : '';
        if (incTs > currentTs) {
          currentTs = incTs;
          currentChatId = chatId;
          currentInboundId = inboundId;
        }
      }
      // Пустой snapshot (нет inbounds вообще) → всё равно violation,
      // без проверки delivered (нечего проверять).
      if (currentChatId) {
        // Проверяем: для currentChatId+currentInboundId есть delivered event?
        const explained = events.some(e =>
          e.type === 'delivered' &&
          (e.outbound_message_ids || []).length > 0 &&
          e.chat_id === currentChatId &&
          e.inbound_message_id === currentInboundId
        );
        if (explained) continue;  // Этот turn объяснён, не violation.
      }
      // Эмитим ОТДЕЛЬНЫЙ event для этого violating turn (НЕ первый из массива).
      events.push({
        type: 'assistant_plain_text_no_reply',
        scope: 'unscoped',
        chat_id: null,
        inbound_message_id: null,
        assistant_ts: t.ts,
        response_text: t.response_text,
        reason: 'violation_of_contract',
        multi_chat: isMultiChatSession,
        session_chat_count: sessionChatCount,
        // v3.1.1: стабильный session_id для построения incident_key в super_bot.
        session_id: sessionId,
      });
    }
  } else {
    // Scoped: ровно один chat в сессии → per-turn по snapshot этого чата.
    //
    // Повторный review (18.08.2026): для КАЖДОГО violating turn эмитим
    // ОТДЕЛЬНЫЙ event со своим assistant_ts, response_text и
    // inbound_message_id (свой для каждого turn — НЕ последний сессии).
    const [chatId] = Array.from(lastInboundPerChat.entries())[0];
    for (const t of assistantTurns) {
      if (!(t.has_text && !t.has_reply_tool_use)) continue;
      const snapshotInboundId = t.snapshot.get(chatId);
      if (!snapshotInboundId) {
        // Пустой snapshot → всё равно violation, берём последний inbound
        // сессии для атрибуции (но incident_key от assistant_ts).
        const lastInboundId = Array.from(lastInboundPerChat.entries())[0][1];
        events.push({
          type: 'assistant_plain_text_no_reply',
          scope: 'scoped',
          chat_id: chatId,
          inbound_message_id: lastInboundId,
          assistant_ts: t.ts,
          response_text: t.response_text,
          reason: 'violation_of_contract',
          multi_chat: false,
          session_chat_count: 1,
          session_id: sessionId,
        });
        continue;
      }
      const alreadyDelivered = events.some(e =>
        e.chat_id === chatId &&
        e.inbound_message_id === snapshotInboundId &&
        (e.type === 'delivered' || e.type === 'reply_started')
      );
      if (alreadyDelivered) continue;  // Не violation.
      // Эмитим ОТДЕЛЬНЫЙ event для этого violating turn.
      events.push({
        type: 'assistant_plain_text_no_reply',
        scope: 'scoped',
        chat_id: chatId,
        inbound_message_id: snapshotInboundId,
        assistant_ts: t.ts,
        response_text: t.response_text,
        reason: 'violation_of_contract',
        multi_chat: false,
        session_chat_count: 1,
        session_id: sessionId,
      });
    }
  }

  // Сортируем chronologically по ts (первое событие = самый старый).
  events.sort((a, b) => {
    const aTs = a.received_at || a.tool_call_ts || a.tool_result_ts || a.assistant_ts || '';
    const bTs = b.received_at || b.tool_call_ts || b.tool_result_ts || b.assistant_ts || '';
    if (aTs !== bTs) return aTs < bTs ? -1 : 1;
    if (a.chat_id !== b.chat_id) return a.chat_id < b.chat_id ? -1 : 1;
    return 0;
  });

  return events;
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

  // 17.08.2026 v2: /delivery — события Telegram delivery из JSONL
  // (см. getDeliveries выше). Используется super_bot'ом для outbox'а и нового
  // silence supervisor'а. Ответ — массив событий (inbound/reply_started/delivered/
  // failed/unknown_no_tool_reply) с chat_id + inbound_message_id. response_text
  // — это исходящий текст бота (не пользовательский).
  if (url.pathname === '/delivery') {
    try {
      const file = findLatestTranscript();
      if (!file) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, no_session_yet: true, events: [] }));
        return;
      }
      const since = url.searchParams.get('since') || '';
      let events = getDeliveries(file);
      if (since) {
        // Фильтр по любой ts-метке события (received_at/tool_call_ts/...).
        events = events.filter(e => {
          const ts = e.received_at || e.tool_call_ts || e.tool_result_ts || e.assistant_ts || '';
          return ts > since;
        });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, events }));
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
  //
  // ⚠️ DEBUG-ЭНДПОИНТЫ (stat/touch). Оставлены по запросу Андрея 14.08.2026
  // для возможных будущих проблем с pairing/persistence. Не используются
  // в проде — только для онбординга и диагностики. Удалить после стабилизации
  // бота у Иры (~28.08.2026, дедлайн по договору).
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
        const out = { ok: true, path: target, pid: process.pid, cwd: process.cwd() };
        try { fs.mkdirSync(path.dirname(target), { recursive: true }); out.mkdirOk = true; }
        catch (e) { out.mkdirError = String(e); out.mkdirCode = e.code; }
        try { fs.writeFileSync(target, content); out.writeOk = true; }
        catch (e) { out.writeError = String(e); out.writeCode = e.code; }
        try { out.readBack = fs.readFileSync(target, 'utf8'); }
        catch (e) { out.readError = String(e); out.readCode = e.code; }
        // Сразу stat, чтобы проверить что fs видит файл
        try {
          const st = fs.statSync(target);
          out.statOk = true; out.statSize = st.size; out.statIno = st.ino; out.statDev = st.dev;
        } catch (e) { out.statError = String(e); out.statCode = e.code; }
        // Листинг родителя
        try { out.parentListing = fs.readdirSync(path.dirname(target)); }
        catch (e) { out.parentListingError = String(e); out.parentListingCode = e.code; }
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

// ---- Fallback-доставка недоотправленных ответов -------------------------
// Замечено в проде у Иры 20.08.2026: модель иногда генерирует полноценный
// ответ (assistant text, stop_reason: end_turn), но не вызывает MCP-инструмент
// reply — текст остаётся только в транскрипте и никогда не доходит до
// Telegram, при этом сессия выглядит рабочей (JSONL растёт, другие тулы
// вызываются). У плагина telegram нет доступа к транскрипту, поэтому сам он
// такое не ловит. Раз в FALLBACK_INTERVAL_MS сканируем последние ходы; если
// ход завершился текстом без успешного reply — досылаем текст напрямую через
// Bot API в обход модели. Каждый ход помечается по uuid входящего сообщения,
// чтобы не отправить fallback дважды.
const FALLBACK_STATE_FILE = path.join('/data', 'claude-home', 'companion-fallback-state.json');
const FALLBACK_INTERVAL_MS = 20000;
const FALLBACK_MIN_AGE_MS = 15000; // не трогать ходы младше этого — модель может ещё работать
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_CHUNK_LIMIT = 4000;

function loadFallbackState() {
  try {
    return JSON.parse(fs.readFileSync(FALLBACK_STATE_FILE, 'utf8'));
  } catch (e) {
    return { delivered: {} };
  }
}

function saveFallbackState(state) {
  try {
    fs.writeFileSync(FALLBACK_STATE_FILE, JSON.stringify(state));
  } catch (e) {
    console.error('[fallback] failed to persist state:', String(e));
  }
}

function extractChatId(text) {
  const m = /<channel[^>]*\schat_id="(\d+)"/.exec(text || '');
  return m ? m[1] : null;
}

async function sendFallback(chatId, text) {
  if (!TELEGRAM_TOKEN) return false;
  let rest = text;
  while (rest.length > 0) {
    const chunk = rest.slice(0, TG_CHUNK_LIMIT);
    rest = rest.slice(TG_CHUNK_LIMIT);
    const resp = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: chunk }),
    });
    const data = await resp.json();
    if (!data.ok) {
      console.error('[fallback] sendMessage failed:', JSON.stringify(data));
      return false;
    }
  }
  return true;
}

// Последовательный проход по файлу: каждое входящее сообщение (user-запись
// со строковым content, то есть настоящий <channel> тег, а не tool_result)
// открывает новую группу-ход. Всё до следующего такого сообщения относится
// к этому ходу — tool_result'ы reply отмечают ход как доставленный, а
// финальный assistant-текст без tool_use в том же content — кандидат на
// fallback, если ход так и не был доставлен.
function findUndeliveredTurns(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  const turns = [];
  let cur = null;

  for (const line of lines) {
    let o;
    try { o = JSON.parse(line); } catch (e) { continue; }
    if (o.type !== 'user' && o.type !== 'assistant') continue;
    const content = o.message && o.message.content;

    if (o.type === 'user' && typeof content === 'string') {
      if (cur) turns.push(cur);
      cur = { id: o.uuid, chatId: extractChatId(content), delivered: false, lastText: null, lastTs: null };
      continue;
    }
    if (!cur) continue;

    if (o.type === 'user' && Array.isArray(content)) {
      for (const b of content) {
        if (b.type !== 'tool_result') continue;
        const inner = b.content;
        if (!Array.isArray(inner)) continue;
        for (const tb of inner) {
          if (tb.type === 'text' && /^sent \(id: \d+/.test(tb.text || '')) cur.delivered = true;
        }
      }
      continue;
    }

    if (o.type === 'assistant' && Array.isArray(content)) {
      const hasToolUse = content.some(b => b.type === 'tool_use');
      if (hasToolUse) continue;
      const textBlock = content.find(b => b.type === 'text' && o.message.stop_reason === 'end_turn');
      if (textBlock && textBlock.text && textBlock.text.trim()) {
        cur.lastText = textBlock.text;
        cur.lastTs = o.timestamp;
      }
    }
  }
  if (cur) turns.push(cur);
  return turns;
}

async function checkUndeliveredAndDeliver() {
  try {
    const file = findLatestTranscript();
    if (!file) return;
    const turns = findUndeliveredTurns(file);
    const state = loadFallbackState();
    const now = Date.now();
    let changed = false;

    for (const turn of turns) {
      if (turn.delivered || !turn.lastText || !turn.chatId) continue;
      if (state.delivered[turn.id]) continue;
      const ts = turn.lastTs ? Date.parse(turn.lastTs) : 0;
      if (!ts || now - ts < FALLBACK_MIN_AGE_MS) continue;

      const ok = await sendFallback(turn.chatId, turn.lastText);
      if (ok) {
        console.log(`[fallback] delivered undetected reply for turn ${turn.id} to chat ${turn.chatId}`);
        state.delivered[turn.id] = true;
        changed = true;
      }
    }

    if (changed) saveFallbackState(state);
  } catch (e) {
    console.error('[fallback] check failed:', String(e));
  }
}

setInterval(checkUndeliveredAndDeliver, FALLBACK_INTERVAL_MS);
