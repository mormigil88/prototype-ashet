#!/usr/bin/env node
// Публикация готового артефакта через approval-gateway (Toto) — вариант А.
// Один вызов = загрузка медиа + заявка (возможно, мульти-цель) + ответ.
//
// Использование (из CLAUDE.md, «Публикация»):
//   node /app/publish_request.js \
//     --caption-file /tmp/caption.txt \
//     --media /tmp/video.mp4 \
//     --content-type short --media-type video \
//     --targets youtube:irina \
//     --auto --source-message-id 12345
//
// Цели: instagram:<username>, youtube:irina|sara|both, telegram_channel,
//       telegram_story_personal, telegram_story_channel (без суффикса).
// Каждую цель — отдельным аргументом --target или список через запятую в --targets.
//
// Правило честности: «заявка создана/опубликовано» можно говорить ТОЛЬКО если
// скрипт завершился с кодом 0 и в JSON ok:true. Любой другой исход — читай
// error/reason и передавай пользователю как есть, не додумывай статус.
const fs = require('fs');
const path = require('path');

function fail(msg) {
  console.error(JSON.stringify({ ok: false, error: msg }, null, 2));
  process.exit(1);
}

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  return (v === undefined || v.startsWith('--')) ? true : v;
}

const UPLOAD_URL = process.env.PUBLISH_GATEWAY_URL_UPLOAD || '';
const GATEWAY_URL = process.env.PUBLISH_GATEWAY_URL || '';
const SECRET = process.env.PUBLISH_GATEWAY_SECRET || '';
const CLIENT_SLUG = process.env.CLIENT_SLUG || 'ashet-irina';

if (!GATEWAY_URL || !SECRET) fail('PUBLISH_GATEWAY_URL / PUBLISH_GATEWAY_SECRET не заданы в окружении');

const captionFile = arg('caption-file');
const mediaPath = arg('media');
const contentType = arg('content-type') || 'post';
const mediaType = arg('media-type') || 'image';
const auto = arg('auto') === true || String(arg('auto')) === 'true';
const sourceMessageId = arg('source-message-id');
const scheduledAt = arg('scheduled-at');

if (!captionFile || typeof captionFile !== 'string') fail('нужен --caption-file <путь>');
if (!fs.existsSync(captionFile)) fail('файл подписи не найден: ' + captionFile);
const caption = fs.readFileSync(captionFile, 'utf8').trim();
if (!caption) fail('файл подписи пуст');

// ── Разбор целей ─────────────────────────────────────────────────────────────
// Поддерживаем и повторные --target, и один --targets "a,b,c".
const raw = []
  .concat(process.argv.flatMap((v, i) => (v === '--target' ? [process.argv[i + 1]] : [])))
  .filter(Boolean);
if (typeof arg('targets') === 'string') raw.push(...String(arg('targets')).split(','));
if (!raw.length) fail('нужны цели: --target instagram:<username> / youtube:irina|sara|both / telegram_channel (можно несколько)');

const TARGET_RE = /^(instagram|youtube|telegram_channel|telegram_story_personal|telegram_story_channel)(:(.+))?$/i;
const targets = [];
for (const item of raw) {
  const m = TARGET_RE.exec(item.trim());
  if (!m) fail(`цель «${item}» не распознана (пример: instagram:irina.verba.coach, youtube:irina)`);
  const platform = m[1].toLowerCase();
  const spec = { platform, content_type: String(contentType) };
  if (platform === 'instagram') {
    const username = (m[3] || '').trim();
    if (!username) fail('для instagram нужен username: instagram:<username>');
    spec.instagram_target = username.replace(/^@/, '');
  }
  if (platform === 'youtube') {
    const t = (m[3] || 'irina').trim().toLowerCase();
    if (!['irina', 'sara', 'both'].includes(t)) fail('youtube-цель: irina | sara | both');
    spec.youtube_target = t;
  }
  targets.push(spec);
}

// ── Шаг 1: загрузка медиа (если есть) ────────────────────────────────────────
async function uploadMedia() {
  if (!mediaPath || typeof mediaPath !== 'string') return '';
  if (!fs.existsSync(mediaPath)) fail('медиа-файл не найден: ' + mediaPath);
  if (!UPLOAD_URL) fail('PUBLISH_GATEWAY_URL_UPLOAD не задан — некуда грузить медиа');
  const body = fs.readFileSync(mediaPath);
  const res = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: {
      'X-Gateway-Secret': SECRET,
      'X-Filename': path.basename(mediaPath),
      'Content-Type': 'application/octet-stream',
      'Content-Length': body.length,
    },
    body,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { fail(`upload: HTTP ${res.status}, ответ не JSON: ${text.slice(0, 200)}`); }
  if (!res.ok || !data.ok || !data.url) fail(`upload: HTTP ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
  return data.url;
}

// ── Шаг 2: заявка ────────────────────────────────────────────────────────────
async function createRequest(imageUrl) {
  const payload = {
    client_slug: CLIENT_SLUG,
    platform: targets[0].platform, // для совместимости; канонические цели — в targets[]
    caption, image_url: imageUrl, content_type: contentType, media_type: mediaType,
    targets,
  };
  if (auto) payload.auto_approve = true;
  if (sourceMessageId && typeof sourceMessageId === 'string') payload.source_message_id = sourceMessageId;
  if (scheduledAt && typeof scheduledAt === 'string') payload.scheduled_at = scheduledAt;

  const res = await fetch(GATEWAY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Gateway-Secret': SECRET },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { fail(`gateway: HTTP ${res.status}, ответ не JSON: ${text.slice(0, 200)}`); }
  if (!res.ok || !data.ok) {
    // auto_publish_disabled и другие отказы гейта — не выдумываем статус.
    fail(`gateway: HTTP ${res.status} ${JSON.stringify(data).slice(0, 400)}`);
  }
  return data;
}

(async () => {
  const imageUrl = await uploadMedia();
  const result = await createRequest(imageUrl);
  // Короткие человекочитаемые строки поверх JSON — чтобы Kimi сразу пересказал.
  for (const r of result.results || []) {
    const mark = r.duplicate ? 'DUPLICATE' : (r.ok ? (r.status || 'created').toUpperCase() : 'ERROR');
    console.log(`${mark} ${r.target || r.platform}${r.request_id ? ' (заявка ' + r.request_id + ')' : ''}${r.error ? ' — ' + r.error : ''}`);
  }
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
})().catch((e) => fail(String(e && e.message || e)));
