#!/usr/bin/env node
// Реестр макетов Canva из ссылок, присланных Ирой в Telegram.
//
// Ира кидает ссылку вида https://www.canva.com/design/<designId>/... — скрипт
// достаёт designId, проверяет макет через GET /v1/designs/{id} и сохраняет его
// в реестр (JSON-файл на volume). Повторная ссылка на тот же ID НЕ создаёт
// дубль — обновляет last_confirmed_at (когда Ира в последний раз подтверждала,
// что макет актуален). Реестр — база для «поиска по макетам» и будущих
// «предложить Ире» сценариев.
//
// Тот же паттерн, что canva_render.js: отдельный Node-скрипт без зависимостей,
// человекочитаемый ответ для Иры — в stdout (последняя строка), прогресс и
// ошибки — в stderr, коды ошибок — CANVA_*.
//
// Команды:
//   node canva_link.js --url "<текст сообщения или сама ссылка>" \
//        --user <tg_user_id> --chat <tg_chat_id>
//
// Реестр (CANVA_DESIGNS_FILE, по умолчанию /data/canva/canva_designs.json) —
// массив записей: { design_id, edit_url, title, source, telegram_user_id,
// telegram_chat_id, registered_at, last_confirmed_at, status }.
// Директория /data/canva создаётся и отдаётся node в entrypoint.sh (сам /data
// root-owned — писать реестр прямо в /data процесс не может).
//
// Токены: ТОЛЬКО читаем access-токен из файла токенов (CANVA_TOKENS_FILE).
// Refresh здесь НЕ делаем намеренно: refresh-токен Canva одноразовый, и два
// скрипта-рефрешера будут рвать цепочку ротации друг друга. Обновление токенов
// — исключительная роль canva_render.js. Если токен протух/401 — скрипт
// просит сначала прогнать `node /app/canva_render.js --check`.
//
// Секреты: env и содержимое токен-файла никогда не печатаются — в ошибках
// только HTTP-статус и тело ответа Canva (без заголовков).
//
// Ядро (registerCanvaDesign) отделено от CLI и бросает CanvaFail вместо
// process.exit — это точка входа для тестов (tests/canva_link.test.js).

const fs = require('fs');
const path = require('path');

// canva.com/design/<id> — id буквенно-цифровой. Ловим ссылку внутри любого
// текста (Ира часто пишет «вот макет ... https://...»), с www и без, с
// query-параметрами (?feature=share&utm=...) и без завершающего слэша.
const CANVA_DESIGN_RE = /https?:\/\/(?:www\.)?canva\.com\/design\/([A-Za-z0-9]+)(?:[/?#]|$)/g;

// env читаем лениво (не в константы модуля) — тесты переопределяют пути
// между кейсами без пересоздания модуля.
const apiBase = () => process.env.CANVA_API_BASE || 'https://api.canva.com/rest/v1';
const tokensFile = () => process.env.CANVA_TOKENS_FILE || '/data/canva_tokens.json';
const designsFile = () => process.env.CANVA_DESIGNS_FILE || '/data/canva/canva_designs.json';

class CanvaFail extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function fail(code, msg) {
  console.error(`${code}: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      args[a.slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

function extractDesignId(text) {
  if (!text) return null;
  CANVA_DESIGN_RE.lastIndex = 0;
  const m = CANVA_DESIGN_RE.exec(String(text));
  return m ? m[1] : null;
}

// ---------- токены (только чтение; refresh — дело canva_render.js) ----------

function readAccessToken() {
  let tokens = null;
  try {
    tokens = JSON.parse(fs.readFileSync(tokensFile(), 'utf8'));
  } catch (_) {
    throw new CanvaFail('CANVA_CONFIG',
      `${tokensFile()} не найден. Доступ к Canva не подключён — это задача Андрея (OAuth через canva_oauth.js). Ире ничего не сохраняем.`);
  }
  if (!tokens.access_token) {
    throw new CanvaFail('CANVA_CONFIG', 'В токен-файле нет access_token. Нужен повторный OAuth (задача Андрея).');
  }
  if (tokens.expires_at && tokens.expires_at <= Date.now() + 60_000) {
    throw new CanvaFail('CANVA_AUTH_DEAD',
      'Access-токен истёк. Сначала обнови токены: node /app/canva_render.js --check (это единственное место, где делается refresh), затем повтори команду.');
  }
  return tokens.access_token;
}

// ---------- HTTP ----------

async function apiGetDesign(designId) {
  const token = readAccessToken();
  let resp;
  try {
    resp = await fetch(`${apiBase()}/designs/${encodeURIComponent(designId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    throw new CanvaFail('CANVA_NETWORK', `Сеть недоступна: ${String((e && e.message) || e)}`);
  }

  if (resp.status === 429) {
    const wait = (parseInt(resp.headers.get('retry-after') || '0', 10) || 3) * 1000;
    console.error(`canva_link: 429 rate limit, жду ${wait / 1000}с`);
    await new Promise(r => setTimeout(r, wait));
    return apiGetDesign(designId);
  }

  // Тело ответа Canva никогда не содержит наших секретов — печатать его можно.
  const text = await resp.text();

  if (resp.status === 401) {
    throw new CanvaFail('CANVA_AUTH_DEAD',
      'Canva отвергла доступ (401): токен невалиден/отозван. Нужен повторный OAuth — задача Андрея. Ничего не сохранено.');
  }
  if (resp.status === 403) {
    throw new CanvaFail('CANVA_ACCESS_DENIED',
      'Интеграции нет доступа к этому макету (403): либо макет вне аккаунта Иры, либо у интеграции нет права чтения дизайнов (scope design:meta:read — задача Андрея, добавить в интеграции и переавторизовать). Ничего не сохранено.');
  }
  if (resp.status === 404) {
    throw new CanvaFail('CANVA_NOT_FOUND',
      'Макет не найден (404): дизайн удалён или ссылка неполная. Ничего не сохранено — попроси Иру проверить ссылку.');
  }
  if (!resp.ok) {
    throw new CanvaFail('CANVA_API', `GET /designs/${designId} → HTTP ${resp.status}: ${text.slice(0, 300)}`);
  }

  let json;
  try { json = JSON.parse(text); } catch (_) {
    throw new CanvaFail('CANVA_API', `Неожиданный (не-JSON) ответ Canva: ${text.slice(0, 200)}`);
  }
  const design = (json && json.design) || json;
  if (!design || !design.id) {
    throw new CanvaFail('CANVA_API', `В ответе нет design.id: ${JSON.stringify(design).slice(0, 300)}`);
  }
  return design;
}

// ---------- реестр ----------

function readRegistry() {
  try {
    const data = JSON.parse(fs.readFileSync(designsFile(), 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (_) {
    return []; // файла ещё нет — начнём с пустого
  }
}

function writeRegistry(registry) {
  // Атомарная запись: tmp + rename — прерванный прогон не оставит битый файл.
  const tmp = `${designsFile()}.tmp.${process.pid}`;
  fs.mkdirSync(path.dirname(designsFile()), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(registry, null, 2));
  fs.renameSync(tmp, designsFile());
}

// Ядро: проверить макет в Canva и записать/обновить реестр. Возвращает
// { design, title, created }. Все отказы — CanvaFail, сохранений нет.
async function registerCanvaDesign(input) {
  const designId = extractDesignId(input.url);
  if (!designId) {
    throw new CanvaFail('CANVA_NO_URL',
      'В сообщении нет ссылки на макет Canva. Нужна ссылка вида https://www.canva.com/design/<id>/... — попроси Иру прислать её через «Поделиться → Копировать ссылку».');
  }

  const design = await apiGetDesign(designId);
  const nowIso = new Date().toISOString();
  const registry = readRegistry();
  const editUrl = (design.urls && (design.urls.edit_url || design.urls.view_url)) || null;
  const title = design.title || '(без имени)';
  const existing = registry.find(r => r.design_id === design.id);

  if (existing) {
    // Дубль по ID: обновляем поля и дату подтверждения, запись одна.
    existing.title = title;
    existing.edit_url = editUrl || existing.edit_url;
    existing.telegram_user_id = input.user;
    existing.telegram_chat_id = input.chat;
    existing.last_confirmed_at = nowIso;
    writeRegistry(registry);
    return { design, title, created: false };
  }

  registry.push({
    design_id: design.id,
    edit_url: editUrl,
    title,
    source: input.source,
    telegram_user_id: input.user,
    telegram_chat_id: input.chat,
    registered_at: nowIso,
    last_confirmed_at: nowIso,
    status: 'registered',
  });
  writeRegistry(registry);
  return { design, title, created: true };
}

// ---------- CLI ----------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    const { design, title, created } = await registerCanvaDesign({
      url: args.url,
      source: 'telegram',
      user: args.user ? Number(args.user) : null,
      chat: args.chat ? Number(args.chat) : null,
    });

    if (!created) {
      console.error(`canva_link: дубликат ${design.id} — запись уже была, обновил last_confirmed_at`);
    } else {
      console.error(`canva_link: макет ${design.id} добавлен в реестр (${designsFile()})`);
    }
    // stdout — готовый текст для Иры (отправлять через reply как есть).
    console.log(`Макет Canva сохранён: ${title}. ID: ${design.id}`);
  } catch (e) {
    if (e instanceof CanvaFail) fail(e.code, e.message);
    fail('CANVA_ERROR', String((e && e.message) || e));
  }
}

if (require.main === module) {
  main().catch(e => fail('CANVA_ERROR', String((e && e.message) || e)));
}

module.exports = { extractDesignId, registerCanvaDesign, CanvaFail, CANVA_DESIGN_RE };
