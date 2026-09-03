#!/usr/bin/env node
// Создаёт HeyGen Digital Twin по подготовленному видео и выдаёт ссылку consent.
// Запускать только после явного согласия Иры на конкретную операцию.
const fs = require('fs');
const path = require('path');
const API_KEY = process.env.HEYGEN_API_KEY;
const API_BASE = 'https://api.heygen.com';
const CONFIG_PATH = '/data/heygen_irina_digital_twin.json';

function fail(message) { console.error(message); process.exit(1); }
async function json(response) { return response.json().catch(() => ({})); }

async function main() {
  if (!API_KEY) fail('HEYGEN_API_KEY не задан в окружении.');
  const [, , name, videoPath] = process.argv;
  if (!name || !videoPath) fail('Использование: node create_digital_twin.js "Irina" <training-video.mp4>');
  if (!fs.existsSync(videoPath)) fail('Файл не найден: ' + videoPath);
  if (fs.statSync(videoPath).size < 1024) fail('Файл слишком мал: нужен полноценный MP4-фрагмент.');

  const headers = { 'x-api-key': API_KEY };
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(videoPath)], { type: 'video/mp4' }), path.basename(videoPath));
  const uploadResponse = await fetch(`${API_BASE}/v3/assets`, { method: 'POST', headers, body: form });
  const upload = await json(uploadResponse);
  const assetId = upload?.data?.asset_id || upload?.asset_id;
  if (!uploadResponse.ok || !assetId) fail(`HeyGen отклонил загрузку видео (${uploadResponse.status}): ${JSON.stringify(upload)}`);

  const createResponse = await fetch(`${API_BASE}/v3/avatars`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'digital_twin', name, file: { type: 'asset_id', asset_id: assetId } }),
  });
  const created = await json(createResponse);
  const item = created?.data?.avatar_item;
  const group = created?.data?.avatar_group;
  if (!createResponse.ok || !item?.id || !group?.id) fail(`HeyGen отклонил создание Digital Twin (${createResponse.status}): ${JSON.stringify(created)}`);

  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ avatar_id: item.id, group_id: group.id, voice_id: item.default_voice_id || null, status: item.status, consent_status: group.consent_status || 'pending', created_at: new Date().toISOString() }, null, 2));

  const consentResponse = await fetch(`${API_BASE}/v3/avatars/${encodeURIComponent(group.id)}/consent`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({}),
  });
  const consent = await json(consentResponse);
  const consentUrl = consent?.data?.url;
  if (!consentResponse.ok || !consentUrl) fail(`Digital Twin создан (avatar_id: ${item.id}), но HeyGen не выдал ссылку на подтверждение (${consentResponse.status}): ${JSON.stringify(consent)}`);

  fs.rmSync(videoPath, { force: true });
  console.log(JSON.stringify({ avatar_id: item.id, group_id: group.id, status: item.status, consent_url: consentUrl, message: 'Ира должна открыть ссылку и записать подтверждение в течение 24 часов. До этого двойника использовать нельзя.' }, null, 2));
}

main().catch(e => fail('Ошибка Digital Twin: ' + (e.message || String(e))));
