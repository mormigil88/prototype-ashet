#!/usr/bin/env node
// Создаёт заявку в Toto / approval-gateway. Сам ничего не публикует.
// Публикация возможна только после подтверждения Иры по ссылке из Telegram.
const fs = require('fs');
const path = require('path');

const PLATFORMS = new Set(['instagram', 'youtube', 'telegram_channel', 'telegram_story_personal', 'telegram_story_channel']);
const CONTENT_TYPES = new Set(['post', 'story', 'reel', 'short']);
const MEDIA_TYPES = new Set(['image', 'video']);
function fail(message) { console.error(JSON.stringify({ ok: false, error: message })); process.exit(1); }
function args(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--') || argv[i + 1] === undefined) fail(`Некорректный аргумент: ${argv[i] || ''}`);
    result[argv[i].slice(2)] = argv[i + 1];
  }
  return result;
}
async function parse(response, stage) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok !== true) fail(`${stage}: ${body.error || `HTTP ${response.status}`}`);
  return body;
}
async function main() {
  const input = args(process.argv.slice(2));
  const gateway = process.env.PUBLISH_GATEWAY_URL;
  const upload = process.env.PUBLISH_GATEWAY_URL_UPLOAD;
  const secret = process.env.PUBLISH_GATEWAY_SECRET;
  if (!gateway || !upload || !secret) fail('Маршрут к Toto не настроен.');
  if (!PLATFORMS.has(input.platform)) fail('Нужна допустимая платформа: instagram, youtube или telegram_channel.');
  if (input['instagram-account'] && input.platform !== 'instagram') fail('--instagram-account можно использовать только с Instagram.');
  const contentType = input['content-type'] || 'post';
  const mediaType = input['media-type'] || 'image';
  if (!CONTENT_TYPES.has(contentType) || !MEDIA_TYPES.has(mediaType)) fail('Неверный content-type или media-type.');
  if (!input.caption) fail('Нужна подпись для публикации.');
  if (!input.media || !fs.existsSync(input.media)) fail('Нужен существующий файл медиа.');
  const ext = path.extname(input.media) || (mediaType === 'video' ? '.mp4' : '.jpg');
  const uploaded = await parse(await fetch(upload, {
    method: 'POST', headers: { 'X-Gateway-Secret': secret, 'X-Filename': `irina${ext}`, 'Content-Type': 'application/octet-stream' }, body: fs.readFileSync(input.media),
  }), 'Загрузка медиа в Toto');
  const request = await parse(await fetch(gateway, {
    method: 'POST', headers: { 'X-Gateway-Secret': secret, 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_slug: 'ashet-irina', platform: input.platform, caption: input.caption, image_url: uploaded.url, content_type: contentType, media_type: mediaType, scheduled_at: input['scheduled-at'] || undefined, instagram_target: input['instagram-account'] || undefined }),
  }), 'Создание заявки в Toto');
  console.log(JSON.stringify({ ok: true, status: request.status, request_id: request.request_id, note: request.note }));
}
main().catch(error => fail(error.message || String(error)));
