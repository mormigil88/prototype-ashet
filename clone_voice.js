#!/usr/bin/env node
// РАЗОВАЯ настройка — Ашет НЕ вызывает этот скрипт сам. Запускать вручную
// (`railway run --service prototype-ashet node clone_voice.js ...`) когда собран
// чистый аудио-образец голоса Ирины. Её собственные голосовые из Telegram
// подходят — не нужна студийная запись, важно только отсутствие шума/музыки/
// посторонних голосов, суммарно 1-3 минуты (если образцов несколько — склей
// их заранее одним файлом, например через ffmpeg). Нужно также явное
// согласие Ирины на клонирование ДО запуска — HeyGen проверяет план подписки
// под эту фичу (403 на бесплатном тарифе), согласие — условие их ToS, не
// формальность. Тот же принцип разового провижининга, что create_avatar.js.
//
// Решение от 22.07.2026 — ElevenLabs убран из архитектуры, HeyGen сам умеет
// клонировать голос (см. developers.heygen.com/reference: POST /v3/voices/clone,
// GET /v3/voices/{id}) — один вендор вместо двух, схема подтверждена в этой
// сессии по официальному источнику.
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.HEYGEN_API_KEY;
const API_BASE = 'https://api.heygen.com';

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.ogg' || ext === '.oga') return 'audio/ogg';
  if (ext === '.m4a') return 'audio/mp4';
  return 'audio/mpeg'; // .mp3 и по умолчанию
}

async function main() {
  if (!API_KEY) fail('HEYGEN_API_KEY не задан в окружении.');

  const [, , name, samplePath] = process.argv;
  if (!name || !samplePath) {
    fail('Использование: node clone_voice.js "<имя, напр. Irina>" <образец.mp3>\n' +
         'Нужно явное согласие Ирины на клонирование ДО запуска.');
  }
  if (!fs.existsSync(samplePath)) fail('Файл не найден: ' + samplePath);

  const base64Data = fs.readFileSync(samplePath).toString('base64');
  const headers = { 'x-api-key': API_KEY, 'Content-Type': 'application/json' };

  let createRes;
  try {
    createRes = await fetch(`${API_BASE}/v3/voices/clone`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        audio: { type: 'base64', media_type: mimeFor(samplePath), data: base64Data },
        voice_name: name,
        remove_background_noise: true,
      }),
    });
  } catch (e) {
    fail('Ошибка запроса к HeyGen (клонирование голоса): ' + String(e.message || e));
  }
  const createBody = await createRes.json().catch(() => ({}));
  const voiceCloneId = createBody?.data?.voice_clone_id;
  if (!createRes.ok || !voiceCloneId) {
    if (createRes.status === 403) {
      fail('HeyGen отклонил (403) — клонирование голоса недоступно на текущем тарифе, нужен апгрейд плана.');
    }
    fail(`HeyGen отклонил клонирование (${createRes.status}): ${JSON.stringify(createBody)}`);
  }

  // Поллинг статуса — до 3 минут, шаг 5с.
  const POLL_INTERVAL_MS = 5000;
  const MAX_WAIT_MS = 3 * 60 * 1000;
  const startedAt = Date.now();

  while (true) {
    if (Date.now() - startedAt > MAX_WAIT_MS) {
      fail(`Таймаут ожидания клонирования (3 мин), voice id: ${voiceCloneId}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    let statusRes;
    try {
      statusRes = await fetch(`${API_BASE}/v3/voices/${voiceCloneId}`, { headers: { 'x-api-key': API_KEY } });
    } catch (e) {
      fail('Ошибка запроса к HeyGen (проверка статуса): ' + String(e.message || e));
    }
    const statusBody = await statusRes.json().catch(() => ({}));
    const status = statusBody?.data?.status || statusBody?.status;

    if (status === 'complete') {
      console.log('voice_id:', voiceCloneId);
      console.log('Сохрани в Railway: railway variable set "HEYGEN_VOICE_ID_IRINA=' + voiceCloneId + '" --service prototype-ashet');
      return;
    }
    if (status === 'failed') {
      fail('HeyGen: клонирование не удалось — ' + (statusBody?.data?.failure_message || statusBody?.failure_message || 'без описания'));
    }
    // processing — продолжаем ждать
  }
}

main();
