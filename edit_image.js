#!/usr/bin/env node
// Накладывает текст на фото через ImageMagick (детерминированный рендер пикселей,
// НЕ AI-генерация) — генеративные модели ненадёжно рисуют точный читаемый текст,
// та же причина, по которой на платформе NeuroStaff завели text_quality.py.
// Вызывается Ашетом через bash после download_attachment, тем же паттерном, что
// transcribe.js: отдельный Node-скрипт, всё через execFile (без shell), поэтому
// текст с кавычками/$/бэктиками от Ольги безопасен без ручного экранирования.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const FONT = process.env.IMAGE_EDIT_FONT || 'DejaVu-Sans-Bold';

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function main() {
  const [, , inputPath, text, positionArg, outputArg] = process.argv;
  if (!inputPath || !text) {
    fail('Использование: node edit_image.js <путь-к-фото> <текст> [top|center|bottom] [путь-к-результату]');
  }
  if (!fs.existsSync(inputPath)) {
    fail('Файл не найден: ' + inputPath);
  }

  const position = ['top', 'center', 'bottom'].includes(positionArg) ? positionArg : 'bottom';
  const gravity = { top: 'North', center: 'Center', bottom: 'South' }[position];

  const outputPath = outputArg || path.join(
    path.dirname(inputPath),
    path.basename(inputPath, path.extname(inputPath)) + '_captioned.jpg'
  );

  let dims;
  try {
    dims = execFileSync('identify', ['-format', '%wx%h', inputPath]).toString().trim();
  } catch (e) {
    fail('Не удалось прочитать изображение (identify): ' + String(e.message || e));
  }
  const [width, height] = dims.split('x').map(n => parseInt(n, 10));
  if (!width || width < 50 || !height || height < 50) fail('Некорректные размеры изображения: ' + dims);

  // Instagram/Buffer перекраивают фото под сторис (9:16) центральным кропом по
  // ширине, если исходник шире (например обычное вертикальное фото телефона
  // 3:4) — если текст растянут на всю ширину исходника, платформа обрежет его
  // вместе с краями кадра (живой баг: полный текст был на фото, Instagram
  // обрезал "Она"→"на" и "Как"→"К" по бокам после кропа под сторис). Поэтому
  // ограничиваем ширину текстового блока безопасной зоной, которая переживёт
  // такой кроп — на 8% уже теоретического 9:16, чтобы не упереться впритык.
  const storySafeWidth = Math.round(height * 9 / 16 * 0.92);
  const textWidth = Math.max(50, Math.min(width, storySafeWidth));

  // Эвристика размера шрифта от ширины текстового блока — короткие подписи
  // типа "Мой размер" остаются читаемыми и не занимают весь кадр; caption:
  // ниже сам переносит строки, если текст длиннее одной строки на этой ширине.
  const pointsize = Math.max(28, Math.min(72, Math.round(textWidth / 14)));
  const captionPng = path.join(os.tmpdir(), `caption_${Date.now()}_${process.pid}.png`);

  try {
    // Шаг 1: рендерим текст отдельной прозрачной картинкой — caption: сам переносит
    // строки по ширине, белая заливка + чёрная обводка читаются на любом фоне фото.
    // Ширина блока уже безопасной зоны (см. storySafeWidth) — при композите ниже
    // gravity центрирует его по горизонтали, оставляя поля по краям кадра.
    execFileSync('convert', [
      '-size', `${textWidth}x`,
      '-background', 'none',
      '-fill', 'white',
      '-stroke', 'black',
      '-strokewidth', '2',
      '-font', FONT,
      '-pointsize', String(pointsize),
      '-gravity', 'center',
      `caption:${text}`,
      captionPng,
    ]);

    // Шаг 2: накладываем готовую надпись на оригинальное фото.
    execFileSync('convert', [
      inputPath,
      captionPng,
      '-gravity', gravity,
      '-geometry', '+0+30',
      '-compose', 'over',
      '-composite',
      outputPath,
    ]);
  } catch (e) {
    try { fs.unlinkSync(captionPng); } catch (_) {}
    fail('Ошибка ImageMagick: ' + String(e.message || e));
  }

  try { fs.unlinkSync(captionPng); } catch (_) {}

  if (!fs.existsSync(outputPath)) {
    fail('Результат не создан: ' + outputPath);
  }

  console.log(outputPath);
}

main();
