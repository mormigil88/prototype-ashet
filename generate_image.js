#!/usr/bin/env node
// Генерирует изображение по текстовому описанию.
// Основной движок — OpenAI (gpt-image-1), запрошен Ольгой ради стиля/качества
// (сменили с Runway 02.08.2026). Runway остаётся резервным движком: он тоже
// платный и уже проверен вживую (переход на него с бесплатного Pollinations
// 23.07.2026 из-за артефактов на пальцах рук), но включается ТОЛЬКО по явному
// запросу — либо третьим аргументом, либо когда OpenAI отвечает нехваткой
// денег/квоты (см. failNoFunds). Автоматического молчаливого переключения нет:
// Ашету предписано (CLAUDE.md) сначала спросить Ольгу.
//   OpenAI:  POST /v1/images/generations { model: 'gpt-image-1', prompt, size, quality }
//            → { data: [{ b64_json }] } (gpt-image-1 всегда отдаёт base64, не url)
//   Runway:  POST /v1/text_to_image { model: 'gen4_image', promptText, ratio } → { id }
//            GET /v1/tasks/{id} → { status, output: [url] }
const fs = require('fs');
const os = require('os');
const path = require('path');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const RUNWAY_API_KEY = process.env.RUNWAY_API_KEY;

const OPENAI_SIZES = {
  square: '1024x1024',
  // У gpt-image-1 нет отдельного 9:16/3:4 — только квадрат и два портрет/ландшафт
  // варианта. 1024x1536 (2:3) — ближайший портретный вариант и под сторис, и под пост.
  story: '1024x1536',
  post: '1024x1536',
};

const RUNWAY_RATIOS = {
  square: '1080:1080',
  story: '1080:1920',
  post: '1080:1440',
};

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function failNoFunds(msg) {
  console.error('OPENAI_NO_FUNDS: ' + msg);
  process.exit(3);
}

function looksLikeNoFunds(status, body) {
  const code = body && body.error && (body.error.code || '');
  const message = (body && body.error && body.error.message || '').toLowerCase();
  if (code === 'insufficient_quota' || code === 'billing_hard_limit_reached') return true;
  if (status === 429 && message.includes('quota')) return true;
  if (message.includes('billing') || message.includes('exceeded your current quota')) return true;
  return false;
}

function extFromContentType(ct) {
  if (!ct) return '.png';
  if (ct.includes('jpeg') || ct.includes('jpg')) return '.jpg';
  if (ct.includes('webp')) return '.webp';
  return '.png';
}

function writeOutput(buf, ext) {
  const outputPath = path.join(os.tmpdir(), `ashet_img_${Date.now()}_${process.pid}${ext}`);
  fs.writeFileSync(outputPath, buf);
  console.log(outputPath);
}

async function generateViaOpenAI(prompt, orientation) {
  if (!OPENAI_API_KEY) {
    fail('OPENAI_API_KEY не задан в окружении контейнера');
  }
  const size = OPENAI_SIZES[orientation] || OPENAI_SIZES.square;

  let res;
  try {
    res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt,
        size,
        quality: 'high',
        n: 1,
      }),
    });
  } catch (e) {
    fail('Ошибка запроса к OpenAI: ' + String(e.message || e));
  }

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (looksLikeNoFunds(res.status, body)) {
      failNoFunds(JSON.stringify(body.error || body));
    }
    fail(`OpenAI отклонил задачу (${res.status}): ${JSON.stringify(body)}`);
  }

  const b64 = body.data && body.data[0] && body.data[0].b64_json;
  if (!b64) fail('OpenAI вернул успех без изображения: ' + JSON.stringify(body));

  writeOutput(Buffer.from(b64, 'base64'), '.png');
}

async function generateViaRunway(prompt, orientation) {
  if (!RUNWAY_API_KEY) {
    fail('RUNWAY_API_KEY не задан в окружении контейнера');
  }
  const ratio = RUNWAY_RATIOS[orientation] || RUNWAY_RATIOS.square;
  const API_BASE = 'https://api.dev.runwayml.com/v1';
  const headers = {
    'Authorization': `Bearer ${RUNWAY_API_KEY}`,
    'Content-Type': 'application/json',
    'X-Runway-Version': '2024-11-06',
  };

  let createRes;
  try {
    createRes = await fetch(`${API_BASE}/text_to_image`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: 'gen4_image', promptText: prompt, ratio }),
    });
  } catch (e) {
    fail('Ошибка запроса к Runway (создание задачи): ' + String(e.message || e));
  }

  const createBody = await createRes.json().catch(() => ({}));
  if (!createRes.ok || !createBody.id) {
    fail(`Runway отклонил задачу (${createRes.status}): ${JSON.stringify(createBody)}`);
  }

  const taskId = createBody.id;
  const POLL_INTERVAL_MS = 3000;
  const MAX_WAIT_MS = 2 * 60 * 1000;
  const startedAt = Date.now();

  while (true) {
    if (Date.now() - startedAt > MAX_WAIT_MS) {
      fail(`Таймаут ожидания результата Runway (2 мин), task id: ${taskId}`);
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
      const imageUrl = (statusBody.output || [])[0];
      if (!imageUrl) fail('Runway вернул SUCCEEDED без output-ссылки: ' + JSON.stringify(statusBody));

      let imageRes;
      try {
        imageRes = await fetch(imageUrl);
      } catch (e) {
        fail('Не удалось скачать готовую картинку: ' + String(e.message || e));
      }
      const ext = extFromContentType(imageRes.headers.get('content-type'));
      writeOutput(Buffer.from(await imageRes.arrayBuffer()), ext);
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

async function main() {
  const [, , prompt, orientationArg, engineArg] = process.argv;
  if (!prompt) {
    fail('Использование: node generate_image.js "<промпт>" [square|story|post] [openai|runway]');
  }
  const orientation = ['square', 'story', 'post'].includes(orientationArg) ? orientationArg : 'square';
  const engine = engineArg === 'runway' ? 'runway' : 'openai';

  if (engine === 'runway') {
    await generateViaRunway(prompt, orientation);
  } else {
    await generateViaOpenAI(prompt, orientation);
  }
}

main();
