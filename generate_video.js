#!/usr/bin/env node
// Оживляет фото в короткое видео через Runway API (image_to_video, модель gen4_turbo —
// в 2.4 раза дешевле gen4.5 за секунду, дефолт по деньгам). Вызывается Ашетом через
// execFile (без shell), тот же паттерн, что generate_image.js/edit_image.js.
// Схема API подтверждена по официальному источнику (docs.dev.runwayml.com/guides/using-the-api/
// + исходники github.com/runwayml/sdk-python), не по вторичным блогам:
//   POST /v1/image_to_video { model, promptImage (URL или data: URI), promptText, ratio, duration }
//   → { id }
//   GET /v1/tasks/{id} → { status: PENDING|THROTTLED|RUNNING|SUCCEEDED|FAILED|CANCELLED, output: [url] }
// output-ссылка живёт 24-48ч — скачиваем сразу, не полагаемся, что она будет доступна позже.
const fs = require('fs');
const os = require('os');
const path = require('path');

const API_BASE = 'https://api.dev.runwayml.com/v1';
const API_KEY = process.env.RUNWAY_API_KEY;
const RUNWAY_VERSION = '2024-11-06';
const MODEL = 'gen4_turbo';

const RATIOS = {
  story: '720:1280',   // 9:16 — Instagram/Telegram Stories, Reels
  square: '960:960',   // 1:1
  landscape: '1280:720', // 16:9
};

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.png' ? 'image/png' : 'image/jpeg';
}

async function main() {
  if (!API_KEY) {
    fail('RUNWAY_API_KEY не задан в окружении контейнера');
  }

  const [, , imagePath, promptText, durationArg, ratioArg] = process.argv;
  if (!imagePath || !promptText) {
    fail('Использование: node generate_video.js <путь-к-фото> "<промпт-движения>" [5|10] [story|square|landscape]');
  }
  if (!fs.existsSync(imagePath)) {
    fail('Файл не найден: ' + imagePath);
  }

  const duration = [5, 10].includes(Number(durationArg)) ? Number(durationArg) : 5;
  const ratio = RATIOS[ratioArg] || RATIOS.story;

  const imageBuf = fs.readFileSync(imagePath);
  const dataUri = `data:${mimeFor(imagePath)};base64,${imageBuf.toString('base64')}`;

  const headers = {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
    'X-Runway-Version': RUNWAY_VERSION,
  };

  let createRes;
  try {
    createRes = await fetch(`${API_BASE}/image_to_video`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: MODEL,
        promptImage: dataUri,
        promptText: promptText,
        ratio,
        duration,
      }),
    });
  } catch (e) {
    fail('Ошибка запроса к Runway (создание задачи): ' + String(e.message || e));
  }

  const createBody = await createRes.json().catch(() => ({}));
  if (!createRes.ok || !createBody.id) {
    fail(`Runway отклонил задачу (${createRes.status}): ${JSON.stringify(createBody)}`);
  }

  const taskId = createBody.id;

  // Поллинг статуса — до 5 минут, шаг 5с. Обычный клип 5-10с генерируется заметно
  // быстрее, но очередь на стороне Runway непредсказуема, лучше подождать честно, чем
  // ложно сообщить об ошибке.
  const POLL_INTERVAL_MS = 5000;
  const MAX_WAIT_MS = 5 * 60 * 1000;
  const startedAt = Date.now();

  while (true) {
    if (Date.now() - startedAt > MAX_WAIT_MS) {
      fail(`Таймаут ожидания результата Runway (5 мин), task id: ${taskId}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    let statusRes;
    try {
      statusRes = await fetch(`${API_BASE}/tasks/${taskId}`, { headers });
    } catch (e) {
      fail('Ошибка запроса к Runway (проверка статуса): ' + String(e.message || e));
    }
    const statusBody = await statusRes.json().catch(() => ({}));

    if (statusBody.status === 'SUCCEEDED') {
      const videoUrl = (statusBody.output || [])[0];
      if (!videoUrl) fail('Runway вернул SUCCEEDED без output-ссылки: ' + JSON.stringify(statusBody));

      let videoRes;
      try {
        videoRes = await fetch(videoUrl);
      } catch (e) {
        fail('Не удалось скачать готовое видео: ' + String(e.message || e));
      }
      const buf = Buffer.from(await videoRes.arrayBuffer());
      const outputPath = path.join(os.tmpdir(), `ashet_video_${Date.now()}_${process.pid}.mp4`);
      fs.writeFileSync(outputPath, buf);
      console.log(outputPath);
      return;
    }

    if (statusBody.status === 'FAILED') {
      fail(`Runway: генерация не удалась — ${statusBody.failure || 'без описания'} (${statusBody.failureCode || 'нет кода'})`);
    }
    if (statusBody.status === 'CANCELLED') {
      fail('Runway: задача отменена');
    }
    // PENDING / THROTTLED / RUNNING — продолжаем ждать
  }
}

main();
