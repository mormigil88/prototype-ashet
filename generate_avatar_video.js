#!/usr/bin/env node
// Генерирует говорящее видео с аватаром и клонированным голосом Ольги —
// целиком через HeyGen (синтез речи её клонированным голосом + липсинк
// аватара в одном вызове). Решение от 22.07.2026: ElevenLabs убран из
// архитектуры — HeyGen сам умеет клонировать голос (см. clone_voice.js),
// один вендор вместо двух, отдельная загрузка аудио на промежуточный
// публичный URL (как было раньше через $PUBLISH_GATEWAY_URL_UPLOAD) больше
// не нужна.
// Тот же паттерн, что generate_video.js (Runway): Node-скрипт, execFile без
// shell, поллинг статуса, путь к результату — в stdout.
//
// Схема подтверждена через developers.heygen.com/reference в этой сессии
// (POST /v3/videos с script+voice_id, GET /v3/videos/{id}).
const fs = require('fs');
const os = require('os');
const path = require('path');

const API_KEY = process.env.HEYGEN_API_KEY;
const AVATAR_ID = process.env.HEYGEN_AVATAR_ID_OLGA;
const VOICE_ID = process.env.HEYGEN_VOICE_ID_OLGA;
const API_BASE = 'https://api.heygen.com';

const RATIOS = {
  story: '9:16',    // Instagram/Telegram Stories, Reels
  square: '1:1',
  landscape: '16:9',
};

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

async function main() {
  if (!API_KEY) {
    fail('HEYGEN_API_KEY не задан в окружении контейнера — видео-аватар ещё не подключён.');
  }
  if (!AVATAR_ID) {
    fail('HEYGEN_AVATAR_ID_OLGA не задан — её аватар ещё не создан (разовая настройка, см. create_avatar.js).');
  }
  if (!VOICE_ID) {
    fail('HEYGEN_VOICE_ID_OLGA не задан — её голос ещё не клонирован (разовая настройка, см. clone_voice.js).');
  }

  const [, , script, ratioArg] = process.argv;
  if (!script) {
    fail('Использование: node generate_avatar_video.js "<текст сценария>" [story|square|landscape]');
  }
  const ratio = RATIOS[ratioArg] || RATIOS.story;

  const headers = { 'x-api-key': API_KEY, 'Content-Type': 'application/json' };

  let createRes;
  try {
    createRes = await fetch(`${API_BASE}/v3/videos`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type: 'avatar',
        avatar_id: AVATAR_ID,
        script,
        voice_id: VOICE_ID,
        aspect_ratio: ratio,
        resolution: '1080p',
      }),
    });
  } catch (e) {
    fail('Ошибка запроса к HeyGen (создание видео): ' + String(e.message || e));
  }

  const createBody = await createRes.json().catch(() => ({}));
  const videoId = createBody?.data?.video_id;
  if (!createRes.ok || !videoId) {
    fail(`HeyGen отклонил задачу (${createRes.status}): ${JSON.stringify(createBody)}`);
  }

  // Поллинг статуса — до 5 минут, шаг 5с (тот же принцип, что generate_video.js).
  const POLL_INTERVAL_MS = 5000;
  const MAX_WAIT_MS = 5 * 60 * 1000;
  const startedAt = Date.now();

  while (true) {
    if (Date.now() - startedAt > MAX_WAIT_MS) {
      fail(`Таймаут ожидания результата HeyGen (5 мин), video id: ${videoId}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    let statusRes;
    try {
      statusRes = await fetch(`${API_BASE}/v3/videos/${videoId}`, { headers });
    } catch (e) {
      fail('Ошибка запроса к HeyGen (проверка статуса): ' + String(e.message || e));
    }
    const statusBody = await statusRes.json().catch(() => ({}));
    const status = statusBody?.data?.status;

    if (status === 'completed') {
      const videoUrl = statusBody.data.video_url;
      if (!videoUrl) fail('HeyGen вернул completed без video_url: ' + JSON.stringify(statusBody));

      let videoRes;
      try {
        videoRes = await fetch(videoUrl);
      } catch (e) {
        fail('Не удалось скачать готовое видео: ' + String(e.message || e));
      }
      const buf = Buffer.from(await videoRes.arrayBuffer());
      const outputPath = path.join(os.tmpdir(), `ashet_avatar_${Date.now()}_${process.pid}.mp4`);
      fs.writeFileSync(outputPath, buf);
      console.log(outputPath);
      return;
    }

    if (status === 'failed') {
      fail(`HeyGen: генерация не удалась — ${statusBody.data?.failure_message || 'без описания'} (${statusBody.data?.failure_code || 'нет кода'})`);
    }
    // pending / processing / waiting — продолжаем ждать
  }
}

main();
