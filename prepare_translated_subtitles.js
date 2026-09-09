#!/usr/bin/env node
// Шаг 1 английских субтитров: транскрибирует видео в русские таймкоды,
// группирует в фразы и сохраняет captions JSON для последующего перевода
// (перевод делает Claude/Kimi бот в рамках своей подписки).
// Использование: node prepare_translated_subtitles.js <видео.mp4> [captions.json]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const { execFile } = require('child_process');
const { groupWordsIntoCaptions } = require('./subtitle_helpers.js');
const run = promisify(execFile);

async function groqJson(url, body, timeoutMs = 90000) {
  const isForm = body instanceof FormData;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
    },
    body: isForm ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Groq: ${data.error?.message || response.status}`);
  return data;
}

async function transcribeWords(audio) {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(audio)], { type: 'audio/mpeg' }), path.basename(audio));
  form.append('model', process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo');
  form.append('response_format', 'verbose_json');
  form.append('language', 'ru');
  form.append('timestamp_granularities[]', 'word');
  const data = await groqJson('https://api.groq.com/openai/v1/audio/transcriptions', form);
  if (!Array.isArray(data.words) || !data.words.length) throw new Error('Groq не вернул тайм-коды русской речи');
  return data.words;
}

async function main() {
  const input = process.argv[2];
  const captionsOut = process.argv[3];

  if (!input || !fs.existsSync(input)) {
    console.error('Использование: node prepare_translated_subtitles.js <видео.mp4> [captions.json]');
    process.exit(1);
  }
  if (!process.env.GROQ_API_KEY) {
    console.error('GROQ_API_KEY не задан');
    process.exit(1);
  }

  // Если передан captions.json — загружаем и пропускаем транскрибацию
  if (captionsOut && fs.existsSync(captionsOut)) {
    const existing = JSON.parse(fs.readFileSync(captionsOut, 'utf8'));
    if (Array.isArray(existing.captions) && existing.captions.length) {
      console.log(captionsOut);
      return;
    }
  }

  const nonce = `${process.pid}_${Date.now()}`;
  const audio = path.join(os.tmpdir(), `prepare_audio_${nonce}.mp3`);

  try {
    await run('ffmpeg', ['-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', audio], { maxBuffer: 1024 * 1024 });

    const words = await transcribeWords(audio);
    const captions = groupWordsIntoCaptions(words);
    if (!captions.length) throw new Error('Не удалось выделить фразы для субтитров');

    // Определяем путь для JSON
    let outPath;
    if (captionsOut) {
      outPath = captionsOut;
    } else {
      const dir = path.dirname(input) || os.tmpdir();
      const base = path.basename(input, path.extname(input));
      outPath = path.join(dir, `${base}.captions.json`);
    }

    const payload = {
      source_language: 'ru',
      target_language: 'en',
      captions: captions.map((c) => ({
        id: c.id,
        start: c.start,
        end: c.end,
        source_ru: c.source_ru,
        translated_en: null, // ← заполнит Claude/Kimi бот
      })),
    };

    fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
    console.log(outPath);
  } finally {
    try { fs.unlinkSync(audio); } catch {}
  }
}

if (require.main === module) main().catch((e) => { console.error(e.message || String(e)); process.exit(1); });
