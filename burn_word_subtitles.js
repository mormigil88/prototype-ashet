#!/usr/bin/env node
// Делает вшитые субтитры по словам: Groq Whisper даёт тайм-коды, ffmpeg/libass
// рисует крупный белый текст с чёрной обводкой в нижней трети кадра.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const { execFile } = require('child_process');

const run = promisify(execFile);
const apiKey = process.env.GROQ_API_KEY || '';
const model = process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo';

function assTime(value) {
  const total = Math.max(0, Math.round(Number(value || 0) * 100));
  const cs = total % 100;
  const seconds = Math.floor(total / 100) % 60;
  const minutes = Math.floor(total / 6000) % 60;
  const hours = Math.floor(total / 360000);
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function assText(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/[{}]/g, '').replace(/\r?\n/g, ' ');
}

function makeAss(words) {
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Subtitle,DejaVu Sans,60,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,4,0,2,30,30,320,1\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n`;
  const lines = [];
  for (let i = 0; i < words.length; i += 3) {
    const chunk = words.slice(i, i + 3);
    const start = Number(chunk[0].start);
    const end = Math.max(start + 0.08, Number(chunk[chunk.length - 1].end));
    const text = assText(chunk.map((word) => word.word || word.text || '').join(' ').trim());
    if (text) lines.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Subtitle,,0,0,0,,${text}`);
  }
  return header + lines.join('\n') + '\n';
}

async function main() {
  const input = process.argv[2];
  const output = process.argv[3] || path.join(path.dirname(input || os.tmpdir()), `${path.basename(input || 'video', path.extname(input || ''))}_subtitles.mp4`);
  if (!input || !fs.existsSync(input)) throw new Error('Использование: node burn_word_subtitles.js <видео.mp4> [готовое.mp4]');
  if (!apiKey) throw new Error('GROQ_API_KEY не задан');

  const nonce = `${process.pid}_${Date.now()}`;
  const audio = path.join(os.tmpdir(), `subtitle_audio_${nonce}.mp3`);
  const ass = path.join(os.tmpdir(), `subtitle_words_${nonce}.ass`);
  try {
    await run('ffmpeg', ['-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', audio], { maxBuffer: 1024 * 1024 });
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(audio)], { type: 'audio/mpeg' }), path.basename(audio));
    form.append('model', model);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(90000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`Groq: ${data.error?.message || response.status}`);
    if (!Array.isArray(data.words) || !data.words.length) throw new Error('Groq не вернул тайм-коды слов');
    fs.writeFileSync(ass, makeAss(data.words));
    await run('ffmpeg', ['-y', '-i', input, '-vf', `ass=${ass}`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-c:a', 'copy', '-movflags', '+faststart', output], { maxBuffer: 1024 * 1024 });
    console.log(output);
  } finally {
    for (const file of [audio, ass]) { try { fs.unlinkSync(file); } catch {} }
  }
}

main().catch((error) => { console.error(error.message || String(error)); process.exit(1); });
