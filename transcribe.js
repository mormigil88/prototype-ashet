#!/usr/bin/env node
// Транскрибирует голосовое сообщение через Groq Whisper API (бесплатный тариф,
// тот же GROQ_API_KEY, что у платформы NeuroStaff). Нужен, потому что Claude Code
// Channels/Telegram-плагин сам этого не умеет: download_attachment просто скачивает
// файл, а Read не расшифровывает аудио — отсюда жалоба Ольги "голосовое не
// распознаёт". Вызывается из Ашет через bash после download_attachment.
const fs = require('fs');
const path = require('path');

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const MODEL = process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo';
// Без принудительного 'ru' — форсированный язык на речи на другом языке даёт не
// ошибку, а фонетическую отсебятину (правдоподобные слова, не связанные со
// смыслом оригинала). Пустая строка в GROQ_WHISPER_LANGUAGE (по умолчанию)
// означает автоопределение языка (найдено на амине — Rus Maktabi, узбекская речь).
const LANGUAGE = process.env.GROQ_WHISPER_LANGUAGE || '';

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Использование: node transcribe.js <путь-к-аудиофайлу>');
    process.exit(1);
  }
  if (!GROQ_API_KEY) {
    console.error('GROQ_API_KEY не задан');
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.error('Файл не найден:', filePath);
    process.exit(1);
  }

  const buf = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('file', new Blob([buf]), path.basename(filePath));
  form.append('model', MODEL);
  if (LANGUAGE) form.append('language', LANGUAGE);

  let resp, data;
  try {
    resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
      body: form,
    });
    data = await resp.json();
  } catch (e) {
    console.error('Ошибка сети при обращении к Groq:', String(e));
    process.exit(1);
  }

  if (!resp.ok) {
    console.error('Groq вернул ошибку:', JSON.stringify(data));
    process.exit(1);
  }

  console.log(data.text || '');
}

main();
