#!/usr/bin/env node
// Шаг 2 английских субтитров: читает captions JSON (translated_en заполнены
// Claude/Kimi ботом), валидирует и прожигает субтитры в видео.
// Использование: node burn_translated_subtitles.js <input.mp4> <captions.json> [output.mp4]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const { execFile } = require('child_process');
const { makeAss, validateTranslatedCaptions } = require('./subtitle_helpers.js');
const run = promisify(execFile);

async function main() {
  const input = process.argv[2];
  const captionsJson = process.argv[3];
  const output = process.argv[4] || path.join(
    path.dirname(input || os.tmpdir()),
    `${path.basename(input || 'video', path.extname(input || ''))}_en_subtitles.mp4`,
  );

  if (!input || !fs.existsSync(input)) {
    console.error('Использование: node burn_translated_subtitles.js <видео.mp4> <captions.json> [готовое.mp4]');
    process.exit(1);
  }
  if (!captionsJson || !fs.existsSync(captionsJson)) {
    console.error('captions.json не найден. Запустите сначала: node prepare_translated_subtitles.js <видео.mp4> [captions.json]');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(captionsJson, 'utf8'));
  const captions = data.captions;

  if (!Array.isArray(captions) || !captions.length) {
    console.error('В captions.json нет массива captions');
    process.exit(1);
  }

  const translated = captions.map((c) => ({
    id: c.id,
    start: c.start,
    end: c.end,
    translated_en: c.translated_en,
  }));

  // Проверяем, что translated_en заполнены
  const empty = translated.filter((c) => !c.translated_en || !String(c.translated_en).trim());
  if (empty.length) {
    console.error(`В captions.json ${empty.length} субтитров без translated_en. Заполните их и повторите.`);
    process.exit(1);
  }

  const source = captions.map((c) => ({ id: c.id, start: c.start, end: c.end, source_ru: c.source_ru }));
  const errors = validateTranslatedCaptions(source, translated);
  if (errors.length) {
    console.error(`Ошибки валидации: ${errors.join('; ')}`);
    process.exit(1);
  }

  const nonce = `${process.pid}_${Date.now()}`;
  const ass = path.join(os.tmpdir(), `translated_subtitles_${nonce}.ass`);
  const transcript = path.join(path.dirname(output), `${path.basename(output, path.extname(output))}.translated-subtitles.json`);

  try {
    fs.writeFileSync(transcript, `${JSON.stringify({ source_language: 'ru', target_language: 'en', captions }, null, 2)}\n`);
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
    try { fs.unlinkSync(ass); } catch {}
  }
}

if (require.main === module) main().catch((e) => { console.error(e.message || String(e)); process.exit(1); });
