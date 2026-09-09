#!/usr/bin/env node
// Английские субтитры: сначала точные русские таймкоды, затем перевод фраз.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const { execFile } = require('child_process');
const { groupWordsIntoCaptions, makeAss } = require('./subtitle_helpers.js');
const { translateCaptions } = require('./openrouter_translate.js');
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
  const output = process.argv[3] || path.join(
    path.dirname(input || os.tmpdir()),
    `${path.basename(input || 'video', path.extname(input || ''))}_en_subtitles.mp4`,
  );
  if (!input || !fs.existsSync(input)) throw new Error('Использование: node burn_translated_subtitles.js <видео.mp4> [готовое.mp4]');
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY не задан');
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY не задан');

  const nonce = `${process.pid}_${Date.now()}`;
  const audio = path.join(os.tmpdir(), `translated_subtitle_audio_${nonce}.mp3`);
  const ass = path.join(os.tmpdir(), `translated_subtitles_${nonce}.ass`);
  const transcript = path.join(path.dirname(output), `${path.basename(output, path.extname(output))}.translated-subtitles.json`);

  try {
    await run('ffmpeg', ['-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', audio], { maxBuffer: 1024 * 1024 });

    const captions = groupWordsIntoCaptions(await transcribeWords(audio));
    if (!captions.length) throw new Error('Не удалось выделить фразы для субтитров');

    const translated = await translateCaptions(captions, {
      apiKey: process.env.OPENROUTER_API_KEY,
      model: process.env.OPENROUTER_TRANSLATION_MODEL || 'openai/gpt-oss-20b:free',
      fetchImpl: global.fetch,
    });

    // QA JSON — объединение по id
    const translationsById = new Map(
      translated.map((caption) => [caption.id, caption.translated_en]),
    );
    const qaCaptions = captions.map((caption) => ({
      id: caption.id,
      start: caption.start,
      end: caption.end,
      source_ru: caption.source_ru,
      translated_en: translationsById.get(caption.id),
    }));
    fs.writeFileSync(transcript, `${JSON.stringify({ source_language: 'ru', target_language: 'en', captions: qaCaptions }, null, 2)}\n`);
    fs.writeFileSync(ass, makeAss(translated));

    await run('ffmpeg', [
      '-y', '-i', input,
      '-vf', `ass=${ass}`,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
      '-c:a', 'copy', '-movflags', '+faststart',
      output,
    ], { maxBuffer: 1024 * 1024 });

    // только mp4 в stdout, QA-путь в stderr
    console.log(output);
    console.error(`QA transcript: ${transcript}`);
  } finally {
    for (const file of [audio, ass]) { try { fs.unlinkSync(file); } catch {} }
  }
}

if (require.main === module) main().catch((error) => { console.error(error.message || String(error)); process.exit(1); });

module.exports = {};
