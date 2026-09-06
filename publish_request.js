#!/usr/bin/env node
// Kimi передаёт готовый артефакт Toto на сервере Иры. Toto — единственный
// исполнитель: в нём лежат Publer и Google OAuth, Kimi ключей соцсетей не знает.
//
// Использование (из CLAUDE.md, «Публикация»):
//   node /app/publish_request.js \
//     --caption-file /tmp/caption.txt \
//     --media /tmp/video.mp4 \
//     --content-type short --media-type video \
//     --targets youtube --language ru \
//     --auto --source-message-id 12345
//
// Цели: instagram:<username>, youtube[:ru|en], telegram_channel,
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

const TOTO_URL = (process.env.TOTO_PUBLISH_URL || '').replace(/\/$/, '');
const SECRET = process.env.TOTO_PUBLISH_SECRET || '';
const CLIENT_SLUG = process.env.CLIENT_SLUG || 'ashet-irina';

if (!TOTO_URL || !SECRET) fail('TOTO_PUBLISH_URL / TOTO_PUBLISH_SECRET не заданы в окружении');

const captionFile = arg('caption-file');
const mediaPath = arg('media');
const contentType = arg('content-type') || 'post';
const mediaType = arg('media-type') || 'image';
const auto = arg('auto') === true || String(arg('auto')) === 'true';
const sourceMessageId = arg('source-message-id');
const scheduledAt = arg('scheduled-at');
const contentLanguage = String(arg('language') || '').trim().toLowerCase();
const trial = arg('trial') === true || String(arg('trial')) === 'true';
const trialReel = arg('trial-reel') === true || String(arg('trial-reel')) === 'true';

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
if (!raw.length) fail('нужны цели: --target instagram:<username> / youtube[:ru|en] / telegram_channel (можно несколько)');

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
    const routeLanguage = (m[3] || contentLanguage).trim().toLowerCase();
    if (!['ru', 'en'].includes(routeLanguage)) {
      fail('для youtube обязателен --language ru|en (или youtube:ru / youtube:en)');
    }
    if (contentLanguage && routeLanguage !== contentLanguage) {
      fail('язык в --language и youtube:<язык> должен совпадать');
    }
    spec.content_language = routeLanguage;
  }
  targets.push(spec);
}

// ── Шаг 1: передача медиа Toto (сервер Иры) ───────────────────────────────────
async function uploadMedia() {
  if (!mediaPath || typeof mediaPath !== 'string') return '';
  if (!fs.existsSync(mediaPath)) fail('медиа-файл не найден: ' + mediaPath);
  const body = fs.readFileSync(mediaPath);
  const res = await fetch(`${TOTO_URL}/publisher/media`, {
    method: 'POST',
    headers: {
      'X-Toto-Publish-Secret': SECRET,
      'X-Filename': path.basename(mediaPath),
      'Content-Type': 'application/octet-stream',
      'Content-Length': body.length,
    },
    body,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { fail(`upload: HTTP ${res.status}, ответ не JSON: ${text.slice(0, 200)}`); }
  if (!res.ok || !data.ok || !data.media_url) fail(`upload: HTTP ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
  return { url: data.media_url, filename: data.filename || path.basename(mediaPath) };
}

// ── Шаг 2: команда Toto ──────────────────────────────────────────────────────
async function publishViaToto(media) {
  if (!contentLanguage || !['ru', 'en'].includes(contentLanguage)) fail('для публикации нужен --language ru|en');
  const platforms = [...new Set(targets.map(target => target.platform))];
  const payload = {
    client_slug: CLIENT_SLUG, caption, media_url: media.url, filename: media.filename,
    content_type: contentType, media_type: mediaType, language: contentLanguage, platforms,
    source_message_id: sourceMessageId || null,
    trial: trial,
    trial_reel: trialReel,
  };
  if (scheduledAt && typeof scheduledAt === 'string') payload.scheduled_at = scheduledAt;

  const res = await fetch(`${TOTO_URL}/publisher/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Toto-Publish-Secret': SECRET },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { fail(`gateway: HTTP ${res.status}, ответ не JSON: ${text.slice(0, 200)}`); }
  if (!res.ok || !data.ok) {
    // auto_publish_disabled и другие отказы гейта — не выдумываем статус.
    fail(`Toto: HTTP ${res.status} ${JSON.stringify(data).slice(0, 400)}`);
  }
  return data;
}

(async () => {
  const media = await uploadMedia();
  if (!media) fail('для Toto нужен локальный медиафайл');
  const result = await publishViaToto(media);
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
})().catch((e) => fail(String(e && e.message || e)));
