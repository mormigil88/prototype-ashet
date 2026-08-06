#!/usr/bin/env node
// Склеивает несколько видео-клипов в один рилс (вставки/монтаж) через ffmpeg —
// тот же принцип, что ffmpeg-рецепты в скилле /make-video (slideshow/concat/drawtext),
// портирован в паттерн Ашета: отдельный Node-скрипт, execFile без shell, ffmpeg вызывается
// напрямую как бинарник (как ImageMagick в edit_image.js), без Python/moviepy — тяжёлый
// стек (Python + moviepy + Playwright/Chromium) в этом контейнере не нужен и не установлен.
//
// Каждый вход приводится к единому холсту (по умолчанию 1080x1920, 9:16) через
// scale+pad ПЕРЕД склейкой — источники (разные вызовы generate_video.js, разные фото)
// могут отличаться разрешением, из-за этого простой concat-демуксер с "-c copy" не
// гарантированно сработает. Звук намеренно не переносится (Runway-клипы обычно без
// осмысленной звуковой дорожки, а музыку Ольга добавляет сама в Buffer/Instagram) —
// если понадобится честный аудио-монтаж, это отдельная доработка, не автоматизируем
// заранее то, что не просили.
const fs = require('fs');
const { execFileSync } = require('child_process');

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function main() {
  const [, , outputPath, width = '1080', height = '1920', ...rawArgs] = process.argv;
  // Ширина/высота — необязательные позиционные аргументы ПЕРЕД списком клипов, но
  // если первый "клип" на деле путь к файлу (а не число) — считаем дефолт 1080x1920
  // и берём все хвостовые аргументы как клипы.
  let clips = rawArgs;
  let W = width, H = height;
  if (!/^\d+$/.test(width) || !/^\d+$/.test(height)) {
    clips = [width, height, ...rawArgs].filter(Boolean);
    W = '1080';
    H = '1920';
  }

  if (!outputPath || clips.length < 2) {
    fail('Использование: node compose_video.js <выход.mp4> [ширина высота] <клип1> <клип2> [клип3 ...]\n' +
         'Нужно минимум 2 клипа — для одного клипа этот инструмент не нужен.');
  }
  for (const c of clips) {
    if (!fs.existsSync(c)) fail('Файл не найден: ' + c);
  }

  const n = clips.length;
  const filterParts = [];
  for (let i = 0; i < n; i++) {
    filterParts.push(
      `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
      `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30[v${i}]`
    );
  }
  const concatInputs = Array.from({ length: n }, (_, i) => `[v${i}]`).join('');
  filterParts.push(`${concatInputs}concat=n=${n}:v=1:a=0[outv]`);
  const filterComplex = filterParts.join(';');

  const ffmpegArgs = [];
  for (const c of clips) {
    ffmpegArgs.push('-i', c);
  }
  ffmpegArgs.push(
    '-filter_complex', filterComplex,
    '-map', '[outv]',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-y',
    outputPath
  );

  try {
    execFileSync('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString().slice(-2000) : String(e.message || e);
    fail('Ошибка ffmpeg: ' + stderr);
  }

  if (!fs.existsSync(outputPath)) {
    fail('Результат не создан: ' + outputPath);
  }

  console.log(outputPath);
}

main();
