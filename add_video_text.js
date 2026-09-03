#!/usr/bin/env node
// Детерминированно накладывает текст на готовый ролик через ffmpeg.
// Это не AI-генерация и не тратит кредиты Runway/HeyGen.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const FONT_FILE = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const POSITIONS = {
  top: 'h*0.10',
  center: '(h-text_h)/2',
  bottom: 'h-text_h-h*0.10',
};

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      else resolve(stdout);
    });
  });
}

async function main() {
  const [, , inputPath, text, positionArg] = process.argv;
  if (!inputPath || !text) {
    fail('Использование: node add_video_text.js <видео.mp4> "<текст>" [top|center|bottom]');
  }
  if (!fs.existsSync(inputPath)) fail('Файл не найден: ' + inputPath);

  const position = POSITIONS[positionArg] ? positionArg : 'bottom';
  const textPath = path.join(os.tmpdir(), `video_text_${process.pid}_${Date.now()}.txt`);
  const outputPath = path.join(os.tmpdir(), `captioned_${Date.now()}_${process.pid}.mp4`);
  fs.writeFileSync(textPath, text, 'utf8');

  const filter = [
    `drawtext=fontfile=${FONT_FILE}`,
    `textfile=${textPath}`,
    'fontcolor=white',
    'fontsize=h/18',
    'bordercolor=black',
    'borderw=3',
    'line_spacing=10',
    'x=(w-text_w)/2',
    `y=${POSITIONS[position]}`,
  ].join(':');

  try {
    await run('ffmpeg', [
      '-y', '-i', inputPath, '-vf', filter,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
      '-c:a', 'copy', '-movflags', '+faststart', outputPath,
    ]);
  } catch (error) {
    fail('Не удалось наложить текст на видео: ' + error.message);
  } finally {
    fs.rmSync(textPath, { force: true });
  }

  console.log(outputPath);
}

main();
