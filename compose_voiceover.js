#!/usr/bin/env node
/**
 * compose_voiceover.js — собирает 9:16 MP4 из фото/видео и озвучки.
 *
 * Каждый файл медиа показывается равное время, распределённое по длительности
 * озвучки. Для видео берётся указанный (или последний) кадр как статичное
 * изображение — исходный звук НЕ используется, чтобы не заглушать речь.
 *
 * CLI:
 *   node compose_voiceover.js <аудио.mp3> <выход.mp4> <файл1.jpg> [файл2.jpg ...]
 *   node compose_voiceover.js <аудио.mp3> <выход.mp4> --photos <f1> <f2>
 *   node compose_voiceover.js <аудио.mp3> <выход.mp4> --video <видео.mp4> [--from-end]
 *
 * Опции:
 *   --photos        — все последующие файлы трактуются как фото
 *   --video <file>  — одно видео; из него берётся первый кадр (без звука)
 *   --from-end      — для видео: брать кадр не с начала, а с конца (последний кадр)
 *
 * ffmpeg: 9:16 (1080x1920), видео-кодек libx264, аудио aac 192k, mp4.
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const W = 1080, H = 1920;

// ─── Ошибки ───────────────────────────────────────────────────────────────────

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

// ─── ffprobe helpers ─────────────────────────────────────────────────────────

function getDuration(filePath) {
  const r = spawnSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'csv=p=0', filePath,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const v = parseFloat(r.stdout.trim());
  return isNaN(v) ? 0 : v;
}

function hasAudioStream(filePath) {
  const r = spawnSync('ffprobe', [
    '-v', 'error', '-show_entries', 'stream=codec_type',
    '-of', 'json', filePath,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    const data = JSON.parse(r.stdout);
    return data.streams?.some(s => s.codec_type === 'audio') ?? false;
  } catch { return false; }
}

// ─── Подготовка каждого сегмента ─────────────────────────────────────────────

const TMP_DIR = os.tmpdir();

/**
 * Конвертирует файл в "картинку для слайда" — 9:16 PNG в TMP.
 * Для фото — масштабирует и паддит. Для видео — извлекает 1 кадр.
 * @param {string} srcPath
 * @param {number} durationSec  — длительность этого сегмента
 * @param {boolean} fromEnd     — для видео: кадр с конца?
 * @returns {string} путь к PNG-файлу сегмента
 */
function prepareSlideImage(srcPath, durationSec, fromEnd = false) {
  const streams = getStreams(srcPath);
  const isVideo = streams.some(s => s.codec_type === 'video') && getDuration(srcPath) > 0.5;

  const outPng = path.join(TMP_DIR, `slide_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`);

  const fps = Math.max(1, Math.round(durationSec * 25)); // ≥1fps, но не слишком много

  let args;
  if (isVideo) {
    if (fromEnd) {
      // Seek к концу файла
      args = ['-sseof', '-0.1', '-i', srcPath, '-update', '1', '-q:v', '2', outPng];
    } else {
      // Первый кадр
      args = ['-i', srcPath, '-vf', `select=eq(n\,0),scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`, '-vsync', '0', '-frames:v', '1', '-q:v', '2', '-y', outPng];
    }
  } else {
    // Фото
    args = ['-i', srcPath, '-vf', `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${fps}`, '-q:v', '2', '-y', outPng];
  }

  try {
    execFileSync('ffmpeg', args, { stdio: 'pipe' });
  } catch (e) {
    const err = e.stderr ? e.stderr.toString().slice(-500) : String(e);
    fail('ffmpeg не смог подготовить слайд из ' + srcPath + ': ' + err);
  }

  if (!fs.existsSync(outPng)) fail('Слайд не создан: ' + outPng);
  return outPng;
}

/** Аудит медиа-потоков */
function getStreams(filePath) {
  const r = spawnSync('ffprobe', [
    '-v', 'error', '-show_entries', 'stream=index,codec_type',
    '-of', 'json', filePath,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  try { return JSON.parse(r.stdout).streams ?? []; }
  catch { return []; }
}

// ─── main ─────────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);

  // Быстрый --help
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`Использование:
  node compose_voiceover.js <аудио.mp3> <выход.mp4> <файл1.jpg> [файл2.jpg ...]
  node compose_voiceover.js <аудио.mp3> <выход.mp4> --photos <f1> <f2>
  node compose_voiceover.js <аудио.mp3> <выход.mp4> --video <видео.mp4> [--from-end]
  node compose_voiceover.js <аудио.mp3> <выход.mp4> --video <видео.mp4> --duration <сек>`);
    return;
  }

  let audioPath = null, outputPath = null, mediaFiles = [];
  let fromEnd = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--photos') {
      i++;
      while (i < argv.length && !argv[i].startsWith('--')) mediaFiles.push(argv[i++]);
      i--;
    } else if (a === '--video') {
      mediaFiles.push(argv[++i]);
    } else if (a === '--from-end') {
      fromEnd = true;
    } else if (!audioPath) {
      audioPath = a;
    } else if (!outputPath) {
      outputPath = a;
    } else {
      mediaFiles.push(a);
    }
  }

  if (!audioPath || !outputPath) {
    fail('Использование: node compose_voiceover.js <аудио.mp3> <выход.mp4> <файл1.jpg> [файл2.jpg...]');
  }
  if (!fs.existsSync(audioPath)) fail('Аудиофайл не найден: ' + audioPath);
  if (mediaFiles.length === 0) fail('Нет медиа-файлов');

  for (const f of mediaFiles) {
    if (!fs.existsSync(f)) fail('Медиа-файл не найден: ' + f);
  }

  const audioDuration = getDuration(audioPath);
  if (audioDuration < 0.5) fail('Аудио слишком короткое или нечитаемое');

  // Проверяем ffmpeg
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); }
  catch { fail('ffmpeg не найден'); }

  console.error(`[compose_voiceover] Аудио: ${audioDuration.toFixed(1)} сек., медиа: ${mediaFiles.length} файл(ов)`);

  // Подготовка слайдов
  const segmentDuration = audioDuration / mediaFiles.length;
  const slideFiles = [];

  for (let i = 0; i < mediaFiles.length; i++) {
    const isLast = (i === mediaFiles.length - 1) && mediaFiles.length > 1;
    const segDur = isLast
      ? audioDuration - segmentDuration * (mediaFiles.length - 1) // последний забирает остаток
      : segmentDuration;
    const frameFromEnd = fromEnd && (i === mediaFiles.length - 1);
    const slide = prepareSlideImage(mediaFiles[i], segDur, frameFromEnd);
    slideFiles.push(slide);
    console.error(`[compose_voiceover] Слайд ${i + 1}/${mediaFiles.length}: ${path.basename(mediaFiles[i])} → ${segDur.toFixed(1)} сек.`);
  }

  // Собираем каждый слайд в видео-сегмент с нужной длительностью
  const segPaths = [];
  for (let i = 0; i < slideFiles.length; i++) {
    const dur = (i === slideFiles.length - 1 && slideFiles.length > 1)
      ? audioDuration - segmentDuration * (slideFiles.length - 1)
      : segmentDuration;
    const segOut = path.join(TMP_DIR, `seg_${Date.now()}_${i}.mp4`);

    try {
      execFileSync('ffmpeg', [
        '-loop', '1', '-i', slideFiles[i],
        '-t', String(dur),
        '-vf', `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30`,
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
        '-x264-params', 'nal-hrd=cbr',
        '-b:v', '2500k', '-maxrate', '2500k', '-bufsize', '5000k',
        '-y', segOut,
      ], { stdio: 'pipe' });
    } catch (e) {
      const err = e.stderr ? e.stderr.toString().slice(-500) : String(e);
      // Чистим
      slideFiles.forEach(f => { try { fs.unlinkSync(f); } catch {} });
      fail('ffmpeg segment error: ' + err);
    }
    segPaths.push(segOut);
  }

  // Склейка сегментов
  const concatList = path.join(TMP_DIR, `concat_${Date.now()}.txt`);
  const concatContent = segPaths.map(p => "file '" + p + "'").join('\n');
  fs.writeFileSync(concatList, concatContent, 'utf8');

  const videoOnlyOut = path.join(TMP_DIR, `vo_${Date.now()}.mp4`);
  try {
    execFileSync('ffmpeg', [
      '-f', 'concat', '-safe', '0', '-i', concatList,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-y', videoOnlyOut,
    ], { stdio: 'pipe' });
  } catch (e) {
    const err = e.stderr ? e.stderr.toString().slice(-500) : String(e);
    fail('ffmpeg concat error: ' + err);
  }

  // Наложение озвучки
  try {
    execFileSync('ffmpeg', [
      '-i', videoOnlyOut, '-i', audioPath,
      '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '192k',
      '-shortest',
      '-movflags', '+faststart',
      '-y', outputPath,
    ], { stdio: 'pipe' });
  } catch (e) {
    const err = e.stderr ? e.stderr.toString().slice(-500) : String(e);
    fail('ffmpeg mux error: ' + err);
  }

  // Чистим TMP-файлы
  try { fs.unlinkSync(concatList); } catch {}
  try { fs.unlinkSync(videoOnlyOut); } catch {}
  slideFiles.forEach(f => { try { fs.unlinkSync(f); } catch {} });
  segPaths.forEach(f => { try { fs.unlinkSync(f); } catch {} });

  if (!fs.existsSync(outputPath)) fail('Результат не создан: ' + outputPath);

  const outDuration = getDuration(outputPath);
  console.error(`[compose_voiceover] Готово: ${outputPath} (${outDuration.toFixed(1)} сек.)`);
  console.log(outputPath);
}

main();
