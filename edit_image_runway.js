#!/usr/bin/env node
// Меняет фото через Runway и затем возвращает оригинальное лицо по локальной
// маске. Одежду, причёску и позу генератор менять может, лицо — нет.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const API_KEY = process.env.RUNWAY_API_KEY;
const API_BASE = 'https://api.dev.runwayml.com/v1';
const VERSION = '2024-11-06';
const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const RATIOS = { square: '1080:1080', story: '1080:1920', post: '1080:1440' };

function fail(message) { console.error(`Ошибка защищённого редактирования: ${message}`); process.exit(1); }
function mimeFor(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return null;
}
function runPython(args) {
  try { return execFileSync('python3', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch (error) { fail(String(error.stderr || error.message || error).trim()); }
}
async function fetchJson(url, options) {
  let response;
  try { response = await fetch(url, options); } catch (error) { fail(`сеть Runway: ${String(error.message || error)}`); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) fail(`Runway отклонил запрос (${response.status}): ${JSON.stringify(body)}`);
  return body;
}

async function main() {
  const [, , inputPath, instruction, orientationArg] = process.argv;
  if (!inputPath || !instruction) fail('использование: node /app/edit_image_runway.js <фото> "<что изменить>" [square|story|post]');
  if (!API_KEY) fail('RUNWAY_API_KEY не задан');
  if (!fs.existsSync(inputPath)) fail(`файл не найден: ${inputPath}`);
  const mime = mimeFor(inputPath);
  if (!mime) fail('поддерживаются JPEG, PNG и WebP');
  const input = fs.readFileSync(inputPath);
  if (input.length > MAX_INPUT_BYTES) fail('фото больше 5 МБ; сожми его перед редактированием');

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'irina-protected-edit-'));
  const maskPath = path.join(workDir, 'face-mask.png');
  const rawPath = path.join(workDir, 'runway-output.png');
  const outputPath = path.join(os.tmpdir(), `irina_face_preserved_${Date.now()}_${process.pid}.png`);
  runPython(['/app/segment_face.py', inputPath, maskPath]);

  const headers = {
    Authorization: `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
    'X-Runway-Version': VERSION,
  };
  const reference = `data:${mime};base64,${input.toString('base64')}`;
  const prompt = [
    `Use @original as the exact composition reference. ${instruction}`,
    'Preserve the person\'s identity and face exactly: facial features, skin texture, expression, age and face shape. Do not beautify, redraw, replace, crop, or move the face.',
    'You may change hairstyle, clothing, pose, body, hands, background and other requested elements while keeping the face in the same position and camera angle.',
  ].join(' ');
  const create = await fetchJson(`${API_BASE}/text_to_image`, {
    method: 'POST', headers,
    body: JSON.stringify({
      model: 'gen4_image', ratio: RATIOS[orientationArg] || RATIOS.story,
      promptText: prompt, referenceImages: [{ uri: reference, tag: 'original' }],
    }),
  });
  if (!create.id) fail(`Runway не вернул id задачи: ${JSON.stringify(create)}`);

  const deadline = Date.now() + 180000;
  let outputUrl;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const task = await fetchJson(`${API_BASE}/tasks/${create.id}`, { headers });
    if (task.status === 'SUCCEEDED') { outputUrl = (task.output || [])[0]; break; }
    if (task.status === 'FAILED' || task.status === 'CANCELLED') fail(`задача ${task.status}: ${task.failure || task.failureCode || 'без описания'}`);
  }
  if (!outputUrl) fail('Runway не вернул изображение за 3 минуты');
  let image;
  try { image = await fetch(outputUrl); } catch (error) { fail(`не удалось скачать результат: ${String(error.message || error)}`); }
  if (!image.ok) fail(`не удалось скачать результат Runway (${image.status})`);
  fs.writeFileSync(rawPath, Buffer.from(await image.arrayBuffer()));
  runPython(['/app/preserve_face.py', inputPath, rawPath, maskPath, outputPath]);
  console.log(outputPath);
}

main();
