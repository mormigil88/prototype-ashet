#!/usr/bin/env node
/** Assemble a vertical reel from narration and photos or moving video clips. */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv']);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function probe(filePath) {
  const result = spawnSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_type',
    '-of', 'json', filePath,
  ], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) return { duration: 0, streams: [] };
  try {
    const data = JSON.parse(result.stdout);
    return { duration: Number(data.format?.duration) || 0, streams: data.streams || [] };
  } catch {
    return { duration: 0, streams: [] };
  }
}

function parseArgs(argv) {
  const [audioPath, outputPath, ...rest] = argv;
  const mediaFiles = [];
  let fromEnd = false;
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (token === '--photos') continue;
    if (token === '--video') {
      if (!rest[i + 1]) throw new Error('После --video укажите видеофайл');
      mediaFiles.push(rest[++i]);
    } else if (token === '--from-end') {
      fromEnd = true;
    } else if (token.startsWith('--')) {
      throw new Error(`Неизвестная опция: ${token}`);
    } else {
      mediaFiles.push(token);
    }
  }
  return { audioPath, outputPath, mediaFiles, fromEnd };
}

function buildFfmpegArgs(audioPath, outputPath, mediaFiles, audioDuration, mediaInfo, fromEnd = false) {
  const totalFrames = Math.ceil(audioDuration * FPS);
  if (mediaFiles.length > totalFrames) {
    throw new Error('Слишком много медиафайлов для длительности озвучки');
  }
  const baseFrames = Math.floor(totalFrames / mediaFiles.length);
  const extraFrames = totalFrames % mediaFiles.length;
  const args = ['-hide_banner', '-loglevel', 'error'];
  const filters = [];
  for (let i = 0; i < mediaFiles.length; i++) {
    const info = mediaInfo[i];
    const last = i === mediaFiles.length - 1;
    const frames = baseFrames + (i < extraFrames ? 1 : 0);
    const segmentDuration = frames / FPS;
    if (info.isVideo) {
      if (fromEnd && last && info.duration > segmentDuration) {
        args.push('-ss', String(info.duration - segmentDuration));
      }
      args.push('-i', mediaFiles[i]);
    } else {
      args.push('-loop', '1', '-framerate', String(FPS), '-i', mediaFiles[i]);
    }
    filters.push(
      `[${i}:v]fps=${FPS},scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,` +
      `pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,format=yuv420p,` +
      `tpad=stop_mode=clone:stop_duration=${segmentDuration + 0.2},` +
      `trim=end_frame=${frames},setpts=PTS-STARTPTS[v${i}]`
    );
  }
  args.push('-i', audioPath);
  filters.push(mediaFiles.map((_, i) => `[v${i}]`).join('') +
    `concat=n=${mediaFiles.length}:v=1:a=0[vout]`);
  args.push(
    '-filter_complex', filters.join(';'),
    '-map', '[vout]', '-map', `${mediaFiles.length}:a:0`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    '-t', String(audioDuration), '-movflags', '+faststart', '-y', outputPath,
  );
  return args;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('Использование: node compose_voiceover.js <аудио.mp3> <выход.mp4> <фото/видео> [ещё медиа...] [--from-end]');
    return;
  }
  let input;
  try { input = parseArgs(argv); } catch (error) { fail(error.message); }
  const { audioPath, outputPath, mediaFiles, fromEnd } = input;
  if (!audioPath || !outputPath) fail('Укажите MP3 и путь к выходному MP4');
  if (!fs.existsSync(audioPath)) fail('Аудиофайл не найден: ' + audioPath);
  if (!mediaFiles.length) fail('Нет медиа-файлов');
  for (const file of mediaFiles) {
    if (!fs.existsSync(file)) fail('Медиа-файл не найден: ' + file);
  }

  const audio = probe(audioPath);
  if (audio.duration < 0.5 || !audio.streams.some(s => s.codec_type === 'audio')) {
    fail('Аудио слишком короткое или нечитаемое');
  }
  const mediaInfo = mediaFiles.map(file => {
    const info = probe(file);
    if (!info.streams.some(s => s.codec_type === 'video')) fail('Нет изображения в файле: ' + file);
    return { duration: info.duration, isVideo: VIDEO_EXTENSIONS.has(path.extname(file).toLowerCase()) };
  });

  let args;
  try {
    args = buildFfmpegArgs(audioPath, outputPath, mediaFiles, audio.duration, mediaInfo, fromEnd);
  } catch (error) { fail(error.message); }
  try {
    execFileSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'], maxBuffer: 4 * 1024 * 1024 });
  } catch (error) {
    fail('Ошибка монтажа ffmpeg: ' + (error.stderr?.toString().slice(-1000) || error.message));
  }

  const output = probe(outputPath);
  if (!output.streams.some(s => s.codec_type === 'video') ||
      !output.streams.some(s => s.codec_type === 'audio') ||
      output.duration + 0.15 < audio.duration) {
    fail('Итоговый MP4 не содержит полного видеоряда и озвучки');
  }
  console.log(outputPath);
}

if (require.main === module) main();
module.exports = { parseArgs, buildFfmpegArgs };
