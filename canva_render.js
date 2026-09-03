#!/usr/bin/env node
// Рендер по утверждённым макетам Canva (brand templates) через Connect API.
// Роль Canva — ТОЛЬКО рендер: подставляем разрешённые поля макета (текст/фото/видео)
// через autofill и скачиваем PNG/JPG/PDF/MP4. Layout, шрифты, цвета макета агенту
// менять недоступны API-дизайном принципиально — это же правило закреплено в CLAUDE.md.
// Тот же паттерн, что transcribe.js/edit_image.js: отдельный Node-скрипт без зависимостей,
// для --render stdout = путь к файлу (последняя строка), прогресс и ошибки — в stderr.
//
// Токены: Canva выдаёт ОДНОРАЗОВЫЙ refresh token (ротация: каждый refresh возвращает
// новый, старый умирает вместе со всей цепочкой при повторе). Поэтому env-переменная
// годится только как сид при первом запуске (CANVA_REFRESH_TOKEN_SEED), а живая пара
// access/refresh хранится в файле на постоянном volume (CANVA_TOKENS_FILE, по умолчанию
// /data/canva_tokens.json) и перезаписывается атомарно при каждом refresh.
//
// Команды:
//   node canva_render.js --check
//   node canva_render.js --templates
//   node canva_render.js --fields --template <id>
//   node canva_render.js --render --template <id> --fields '<json>|<файл.json>' \
//        --out /tmp/out.png [--format png|jpg|pdf|mp4] [--title "имя дизайна"]
//
// Формат --fields: {"имя_поля": {"type":"text","text":"..."} |
//                   {"type":"image","asset_path":"/tmp/foto.jpg"} |
//                   {"type":"video","asset_path":"/tmp/clip.mp4"} |
//                   {"type":"image","asset_id":"..."}   // если ассет уже загружен
//                  }
// Canva МОЛЧА пропускает несуществующие имена полей — поэтому перед отправкой
// сверяемся с dataset макета (GET /v1/brand-templates/{id}/dataset) и падаем с
// CANVA_FIELD_MISMATCH, если поле не существует. Тихая подстановка = класс «ложного готово».

const fs = require('fs');
const path = require('path');

const API = 'https://api.canva.com/rest/v1';
const TOKENS_FILE = process.env.CANVA_TOKENS_FILE || '/data/canva_tokens.json';

function fail(code, msg) {
  console.error(`${code}: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check' || a === '--templates' || a === '--fields') args[a.slice(2)] = true;
    else if (a.startsWith('--')) { args[a.slice(2)] = argv[i + 1]; i++; }
  }
  return args;
}

// ---------- токены ----------

function readTokenFile() {
  try {
    return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeTokenFile(tokens) {
  // Атомарная перезапись: tmp + rename, чтобы прерванный refresh не оставил битый файл.
  const tmp = `${TOKENS_FILE}.tmp.${process.pid}`;
  fs.mkdirSync(path.dirname(TOKENS_FILE), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(tokens, null, 2));
  fs.renameSync(tmp, TOKENS_FILE);
}

async function refreshTokens(refreshToken) {
  const clientId = process.env.CANVA_CLIENT_ID;
  const clientSecret = process.env.CANVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    fail('CANVA_CONFIG', 'CANVA_CLIENT_ID / CANVA_CLIENT_SECRET не заданы в env');
  }
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const resp = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    if (resp.status === 400 && (body.error === 'invalid_grant' || body.error === 'invalid_request')) {
      fail('CANVA_AUTH_DEAD',
        'Refresh-токен невалиден (цепочка ротации оборвана). Нужен повторный OAuth через canva_oauth.js — сказать Андрею, не ретраить.');
    }
    fail('CANVA_AUTH', `Не удалось обновить токен: HTTP ${resp.status} ${JSON.stringify(body)}`);
  }
  const tokens = {
    access_token: body.access_token,
    refresh_token: body.refresh_token || refreshToken, // по докам приходит всегда, но не рискуем
    expires_at: Date.now() + (body.expires_in || 14400) * 1000,
    scope: body.scope,
    refreshed_at: new Date().toISOString(),
  };
  writeTokenFile(tokens);
  return tokens;
}

async function getAccessToken() {
  let tokens = readTokenFile();
  if (!tokens) {
    const seed = process.env.CANVA_REFRESH_TOKEN_SEED;
    if (!seed) {
      fail('CANVA_CONFIG',
        `${TOKENS_FILE} не найден и CANVA_REFRESH_TOKEN_SEED не задан. Сначала OAuth через canva_oauth.js (локально) — сказать Андрею.`);
    }
    console.error('canva: bootstrap из CANVA_REFRESH_TOKEN_SEED (сид после этого мёртв — удалить из env)');
    tokens = await refreshTokens(seed);
  }
  if (tokens.expires_at && tokens.expires_at > Date.now() + 60_000) {
    return { token: tokens.access_token, tokens };
  }
  return { token: (await refreshTokens(tokens.refresh_token)).access_token, tokens };
}

// ---------- HTTP ----------

async function apiCall(method, urlPath, { body, rawBody, contentType, retryAuth = true, retries429 = 0 } = {}) {
  const { token, tokens } = await getAccessToken();
  const headers = { Authorization: `Bearer ${token}` };
  if (contentType) headers['Content-Type'] = contentType;
  const resp = await fetch(`${API}${urlPath}`, {
    method,
    headers,
    body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (resp.status === 429 && retries429 < 5) {
    const wait = (parseInt(resp.headers.get('retry-after') || '0', 10) || 2 + retries429 * 3) * 1000;
    console.error(`canva: 429 rate limit, жду ${wait / 1000}с`);
    await new Promise(r => setTimeout(r, wait));
    return apiCall(method, urlPath, { body, rawBody, contentType, retryAuth, retries429: retries429 + 1 });
  }

  if (resp.status === 401 && retryAuth) {
    // Токен протух между проверкой и запросом — форс-рефреш и одна повторная попытка.
    await refreshTokens(tokens.refresh_token);
    return apiCall(method, urlPath, { body, rawBody, contentType, retryAuth: false });
  }

  const text = await resp.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* бинарное тело или пусто */ }
  if (!resp.ok) {
    fail('CANVA_API', `${method} ${urlPath} → HTTP ${resp.status}: ${text.slice(0, 500)}`);
  }
  return json;
}

async function poll(urlPath, extractor, budgetMs, what) {
  const deadline = Date.now() + budgetMs;
  let delay = 2000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, delay));
    delay = Math.min(delay + 1000, 5000);
    const body = await apiCall('GET', urlPath);
    const done = extractor(body);
    if (done !== undefined) return done;
    console.error(`canva: ${what} ещё в работе...`);
  }
  fail('CANVA_TIMEOUT', `${what} не завершилась за ${budgetMs / 1000}с`);
}

// ---------- загрузка ассетов ----------

async function uploadAsset(filePath, kind) {
  if (!fs.existsSync(filePath)) fail('CANVA_ASSET', `Файл не найден: ${filePath}`);
  const name = path.basename(filePath);
  const job = await apiCall('POST', `/assets?name=${encodeURIComponent(name)}`, {
    rawBody: fs.readFileSync(filePath),
    contentType: kind === 'video' ? 'video/mp4' : 'image/jpeg',
  });
  const jobId = (job && job.job && job.job.id) || (job && job.id);
  if (!jobId) fail('CANVA_ASSET', `Неожиданный ответ загрузки ассета: ${JSON.stringify(job).slice(0, 300)}`);

  // У ассета поле статуса называется upload_status (ready/processing/failed).
  const asset = await poll(`/assets/${jobId}`, (b) => {
    const a = (b && b.asset) || b;
    const st = a && (a.upload_status || a.status);
    if (st === 'ready') return a;
    if (st === 'failed') fail('CANVA_ASSET', `Загрузка ассета упала: ${name}`);
    return undefined;
  }, 120_000, `загрузка ассета ${name}`);
  console.error(`canva: ассет загружен ${name} → ${asset.id}`);
  return asset.id;
}

async function resolveFields(fields) {
  const out = {};
  for (const [name, spec] of Object.entries(fields)) {
    if (!spec || typeof spec !== 'object') fail('CANVA_FIELDS', `Поле "${name}": ожидается объект {type,...}`);
    if ((spec.type === 'image' || spec.type === 'video') && spec.asset_path) {
      out[name] = { type: spec.type, asset_id: await uploadAsset(spec.asset_path, spec.type) };
    } else {
      out[name] = spec;
    }
  }
  return out;
}

// ---------- dataset: защита от молчаливого пропуска полей ----------

async function getDataset(templateId) {
  try {
    const resp = await apiCall('GET', `/brand-templates/${templateId}/dataset`);
    return (resp && resp.dataset) || resp;
  } catch (e) {
    console.error(`canva: dataset недоступен (${String(e.message || e).slice(0, 200)}) — пропускаю валидацию полей`);
    return null;
  }
}

function validateFields(dataset, fields) {
  if (!dataset || !dataset.fields) return;
  const known = new Set(Object.keys(dataset.fields));
  const submitted = Object.keys(fields);
  const unknown = submitted.filter(n => !known.has(n));
  if (unknown.length > 0) {
    fail('CANVA_FIELD_MISMATCH',
      `Поля, которых нет в макете: ${unknown.join(', ')}. Существующие поля: ${[...known].join(', ')}. ` +
      'Canva пропустила бы их молча — проверь имена через: node canva_render.js --fields --template <id>');
  }
}

// ---------- команды ----------

async function cmdCheck() {
  const me = await apiCall('GET', '/users/me');
  const team = (me && me.team && me.team.name) || '?';
  console.log(`OK: авторизован как ${me.display_name || me.id} (team: ${team})`);
}

async function cmdTemplates() {
  let continuation = '';
  const seen = [];
  do {
    const resp = await apiCall('GET', `/brand-templates${continuation ? `?continuation=${encodeURIComponent(continuation)}` : ''}`);
    for (const item of (resp && resp.items) || []) {
      seen.push(`  ${item.id}  ${item.title || '(без имени)'}  [обновлён ${item.updated_at || '?'}]`);
    }
    continuation = (resp && resp.continuation) || '';
  } while (continuation);
  if (seen.length === 0) {
    console.error('CANVA_NO_TEMPLATES: ни одного brand template не найдено. ' +
      'Ира должна открыть макет в Canva → Поделиться → «Шаблон бренда». Список утверждённых макетов — у Андрея.');
    process.exit(1);
  }
  console.log(`Бренд-шаблоны (${seen.length}):\n${seen.join('\n')}`);
}

async function cmdFields(templateId) {
  const ds = await getDataset(templateId);
  if (!ds || !ds.fields) fail('CANVA_FIELDS', 'Dataset пуст или недоступен для этого макета');
  for (const [name, spec] of Object.entries(ds.fields)) {
    const extra = spec.asset_id !== undefined ? '' : '';
    console.log(`  ${name}: ${spec.type}${extra}`);
  }
}

async function cmdRender(args) {
  const templateId = args.template;
  if (!templateId) fail('CANVA_FIELDS', 'Укажи --template <id>');
  if (!args.out) fail('CANVA_FIELDS', 'Укажи --out <путь-к-результату>');

  let fields;
  const src = args.fields;
  if (!src) fail('CANVA_FIELDS', 'Укажи --fields \'<json>\' или --fields <файл.json>');
  try {
    fields = JSON.parse(src.startsWith('{') || src.startsWith('[') ? src : fs.readFileSync(src, 'utf8'));
  } catch (e) {
    fail('CANVA_FIELDS', `Не удалось прочитать --fields: ${String(e.message || e)}`);
  }

  const format = { png: 'png', jpg: 'jpg', jpeg: 'jpg', pdf: 'pdf', mp4: 'video', video: 'video' }[String(args.format || 'png').toLowerCase()];
  if (!format) fail('CANVA_FIELDS', 'Формат: png|jpg|pdf|mp4');

  const ds = await getDataset(templateId);
  validateFields(ds, fields);
  const data = await resolveFields(fields);

  console.error(`canva: autofill по шаблону ${templateId}...`);
  const job = await apiCall('POST', '/autofills', {
    body: {
      type: 'create_from_brand_template',
      brand_template_id: templateId,
      data,
      title: args.title || `kimi-${Date.now()}`,
    },
  });
  const jobId = (job && job.job && job.job.id) || (job && job.id);
  if (!jobId) fail('CANVA_API', `Неожиданный ответ autofill: ${JSON.stringify(job).slice(0, 300)}`);

  const design = await poll(`/autofills/${jobId}`, (b) => {
    const j = (b && b.job) || b;
    if (j && j.status === 'completed') return j.design;
    if (j && j.status === 'failed') fail('CANVA_JOB_FAILED', `Autofill упал: ${JSON.stringify(j.error || j).slice(0, 400)}`);
    return undefined;
  }, 120_000, 'autofill');
  const designId = design && design.id;
  if (!designId) fail('CANVA_JOB_FAILED', `В job нет design.id: ${JSON.stringify(design).slice(0, 300)}`);
  console.error(`canva: дизайн создан ${designId}, экспорт в ${format}...`);

  const exportJob = await apiCall('POST', '/exports', { body: { design_id: designId, format } });
  const exportId = (exportJob && exportJob.job && exportJob.job.id) || (exportJob && exportJob.id);
  if (!exportId) fail('CANVA_API', `Неожиданный ответ export: ${JSON.stringify(exportJob).slice(0, 300)}`);

  const urls = await poll(`/exports/${exportId}`, (b) => {
    const j = (b && b.job) || b;
    if (j && j.status === 'success') return j.urls;
    if (j && j.status === 'failed') fail('CANVA_JOB_FAILED', `Экспорт упал: ${JSON.stringify(j.error || j).slice(0, 400)}`);
    return undefined;
  }, 300_000, 'экспорт');
  if (!Array.isArray(urls) || urls.length === 0) fail('CANVA_JOB_FAILED', 'Экспорт без ссылок');

  // Несколько страниц → out.ext, out.2.ext, ...; stdout — путь первой (как edit_image.js).
  const ext = format === 'video' ? 'mp4' : format;
  const results = [];
  for (let i = 0; i < urls.length; i++) {
    const outPath = i === 0 ? args.out : args.out.replace(/(\.[^.]+)$/, `.${i + 1}$1`);
    const resp = await fetch(urls[i]);
    if (!resp.ok) fail('CANVA_JOB_FAILED', `Скачивание результата HTTP ${resp.status}`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, Buffer.from(await resp.arrayBuffer()));
    results.push(outPath);
  }

  // QA-подсказка: что реально подставили — для пересказа Ире рядом с превью.
  const filled = Object.keys(data).join(', ');
  console.error(`canva: готово, поля: ${filled || '(полей не передано)'}`);
  console.log(results[0]);
  if (results.length > 1) console.log(`(ещё страниц: ${results.slice(1).join(', ')})`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    if (args.check) return await cmdCheck();
    if (args.templates) return await cmdTemplates();
    if (args.fields) return await cmdFields(args.template);
    if (args.render) return await cmdRender(args);
    console.error('Использование:\n' +
      '  node canva_render.js --check\n' +
      '  node canva_render.js --templates\n' +
      '  node canva_render.js --fields --template <id>\n' +
      '  node canva_render.js --render --template <id> --fields \'{"заголовок":{"type":"text","text":"..."},\n' +
      '       "фото":{"type":"image","asset_path":"/tmp/foto.jpg"}}\' --out /tmp/out.png [--format png|jpg|pdf|mp4]');
    process.exit(1);
  } catch (e) {
    fail('CANVA_ERROR', String((e && e.message) || e));
  }
}

main();
