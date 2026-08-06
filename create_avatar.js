#!/usr/bin/env node
// РАЗОВАЯ настройка — Ашет НЕ вызывает этот скрипт сам. Запускать вручную
// (`railway run --service ashet-olga node create_avatar.js ...`) один раз,
// когда есть её фото И получено явное согласие на создание цифрового
// аватара — HeyGen технически требует подтверждённое согласие для аватара
// реального человека (условие их платформы, не наша прихоть). Тот же
// принцип разового провижининга, что clone_voice.js/
// telegram_story_login_step1.py.
//
// ⚠️ Схема подтверждена частично через developers.heygen.com/reference в
// этой сессии (POST /v3/assets → POST /v3/avatars), но HeyGen недавно
// мигрировал на v3 и страницу с описанием consent-полей прочитать не
// удалось — свериться с https://developers.heygen.com/reference перед
// первым реальным запуском, особенно на предмет обязательных полей
// согласия, которые платформа может требовать прямо в запросе.
const fs = require('fs');

const API_KEY = process.env.HEYGEN_API_KEY;
const API_BASE = 'https://api.heygen.com';

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

async function main() {
  if (!API_KEY) fail('HEYGEN_API_KEY не задан в окружении.');

  const [, , name, photoPath] = process.argv;
  if (!name || !photoPath) {
    fail('Использование: node create_avatar.js "<имя, напр. Olga>" <фото.jpg>\n' +
         'Нужно явное согласие Ольги на создание её цифрового аватара ДО запуска.');
  }
  if (!fs.existsSync(photoPath)) fail('Файл не найден: ' + photoPath);

  const headers = { 'x-api-key': API_KEY };

  // Шаг 1: загрузить фото как asset.
  let uploadRes;
  try {
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(photoPath)]), photoPath.split('/').pop());
    uploadRes = await fetch(`${API_BASE}/v3/assets`, { method: 'POST', headers, body: form });
  } catch (e) {
    fail('Ошибка загрузки фото в HeyGen: ' + String(e.message || e));
  }
  const uploadBody = await uploadRes.json().catch(() => ({}));
  if (!uploadRes.ok || !uploadBody.asset_id) {
    fail(`HeyGen отклонил загрузку фото (${uploadRes.status}): ${JSON.stringify(uploadBody)}`);
  }

  // Шаг 2: создать аватар из загруженного asset (обучение асинхронное).
  let avatarRes;
  try {
    avatarRes = await fetch(`${API_BASE}/v3/avatars`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'photo',
        name,
        file: { type: 'asset_id', asset_id: uploadBody.asset_id },
      }),
    });
  } catch (e) {
    fail('Ошибка создания аватара в HeyGen: ' + String(e.message || e));
  }
  const avatarBody = await avatarRes.json().catch(() => ({}));
  const avatarId = avatarBody?.data?.avatar_item?.id;
  if (!avatarRes.ok || !avatarId) {
    fail(`HeyGen отклонил создание аватара (${avatarRes.status}): ${JSON.stringify(avatarBody)}`);
  }

  console.log('avatar_id:', avatarId, '(статус:', avatarBody.data.avatar_item.status + ', обучение асинхронное, может занять время)');
  console.log('Сохрани в Railway: railway variable --service ashet-olga --set "HEYGEN_AVATAR_ID_OLGA=' + avatarId + '"');
}

main();
