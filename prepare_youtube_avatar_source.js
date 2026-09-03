#!/usr/bin/env node
// Подготовка собственного ролика Иры для обучения HeyGen Digital Twin.
// Использовать только с её согласием и при наличии прав на исходный ролик.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const run = promisify(execFile);

function fail(message) { console.error(message); process.exit(1); }

function seconds(value, label, fallback) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) fail(`${label} должно быть неотрицательным числом секунд.`);
  return n;
}

function youtubeUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail('Нужна HTTPS-ссылка YouTube.'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || !(host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be' || host.endsWith('.youtu.be'))) {
    fail('Инструмент принимает только HTTPS-ссылки YouTube.');
  }
  return url.toString();
}

async function main() {
  const [, , rawUrl, rawStart, rawDuration] = process.argv;
  if (!rawUrl) fail('Использование: node prepare_youtube_avatar_source.js <youtube-url> [start-sec] [duration-sec]');
  const start = seconds(rawStart, 'Начало', 0);
  const duration = seconds(rawDuration, 'Длительность', 60);
  if (duration < 15 || duration > 600) fail('Для Digital Twin фрагмент должен быть 15–600 секунд. Рекомендую 60–180 секунд.');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heygen-youtube-'));
  try {
    const { stdout } = await run('yt-dlp', [
      '--no-playlist', '--no-warnings', '--merge-output-format', 'mp4',
      '--format', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]',
      '--print', 'after_move:filepath', '--output', path.join(dir, 'source.%(ext)s'), youtubeUrl(rawUrl),
    ], { maxBuffer: 1024 * 1024 });
    const source = stdout.trim().split(/\r?\n/).filter(Boolean).pop();
    if (!source || !fs.existsSync(source)) fail('Не удалось скачать ролик. Проверьте, что он доступен без входа.');
    const output = path.join(os.tmpdir(), `heygen_irina_training_${Date.now()}.mp4`);
    await run('ffmpeg', [
      '-y', '-ss', String(start), '-t', String(duration), '-i', source,
      '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output,
    ], { maxBuffer: 1024 * 1024 });
    if (!fs.existsSync(output) || fs.statSync(output).size < 1024) fail('Не удалось подготовить MP4-фрагмент.');
    console.log(output);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch(e => fail('Ошибка подготовки видео: ' + (e.stderr || e.message || String(e))));
