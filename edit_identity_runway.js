#!/usr/bin/env node
/**
 * edit_identity_runway.js — Runway Gen-4 image edit with tagged references.
 *
 * Использует два reference с тегами:
 *   @person  — лицо и внешность человека (берётся из исходного фото)
 *   @style   — композиция, освещение, палитра, окружение (опционально)
 *
 * Лицо из @style НЕ копируется: промпт содержит явный запрет.
 *
 * Runway API v1:
 *   POST /v1/text_to_image  — создать задачу
 *   GET  /v1/tasks/{id}     — опрос статуса
 *
 * Input limits (data URI):
 *   — максимум 5 МБ после base64-кодирования (Runway docs)
 *   — binary ≤ 3 690 000 байт (~3.52 МБ) с учётом +33% overhead
 *   — форматы: JPEG, PNG, WebP (GIF не поддерживается)
 *   — ratio: '1080:1080' (square), '1080:1920' (story), '1080:1440' (post)
 *
 * MIME определяется по байтовой сигнатуре, не по расширению и не по Content-Type.
 *
 * Usage (production):
 *   node edit_identity_runway.js --source <photo> --prompt "<что изменить>"
 *                                [--reference <style-ref>]
 *                                [--format square|story|post]
 *                                [--timeout <ms>]
 *
 * Module import — безопасен, не обращается к сети.
 */

'use strict';

const { parseArgs } = require('util');
const { setTimeout: sleep } = require('node:timers/promises');
const fs = require('fs');
const path = require('path');

// ─── Constants ──────────────────────────────────────────────────────────────────

const API_BASE = 'https://api.dev.runwayml.com/v1';
const API_VERSION = '2024-11-06';
const MAX_URI_BYTES = 5 * 1024 * 1024;        // 5 МБ — лимит data URI (Runway)
const MAX_BINARY_BYTES = 3_690_000;            // ~3.52 МБ binary = 5 МБ base64
const RATIOS = { square: '1080:1080', story: '1080:1920', post: '1080:1440' };

/**
 * Байтовые сигнатуры для определения MIME.
 * JPEG: FF D8 FF
 * PNG:  89 50 4E 47 0D 0A 1A 0A  (полная 8-байтная сигнатура)
 * WebP: 52 49 46 46 ?? ?? ?? ?? 57 45 42 50  (RIFF....WEBP)
 */
const SIGNATURES = [
  { bytes: [0xFF, 0xD8, 0xFF], mime: 'image/jpeg' },
  { bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], mime: 'image/png' },
  { sig: (b) => b[0]===0x52&&b[1]===0x49&&b[2]===0x46&&b[3]===0x46
                 &&b[8]===0x57&&b[9]===0x45&&b[10]===0x42&&b[11]===0x50,
         mime: 'image/webp' },
];

/**
 * Расширение → MIME для output (результат Runway → файл).
 * Используется когда Content-Type корректный.
 */
const MIME_TO_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// ─── Errors ────────────────────────────────────────────────────────────────────

class RunwayError extends Error {
  constructor(msg, taskId = null) { super(msg); this.name = 'RunwayError'; this.taskId = taskId; }
}

function fail(msg) { console.error(msg); process.exit(1); }

// ─── MIME detection by bytes ───────────────────────────────────────────────────

/**
 * Определяет MIME по байтовой сигнатуре.
 * @param {Buffer|Uint8Array} buf
 * @returns {'image/jpeg'|'image/png'|'image/webp'|null}
 */
function detectMime(buf) {
  for (const sig of SIGNATURES) {
    if (sig.sig) { if (sig.sig(buf)) return sig.mime; }
    else {
      if (sig.bytes.every((b, i) => buf[i] === b)) return sig.mime;
    }
  }
  return null;
}

// ─── Validation ────────────────────────────────────────────────────────────────

/**
 * Проверяет файл до любого сетевого вызова.
 * MIME определяется по байтам, расширение — только для сообщений.
 *
 * @param {string} filePath
 * @param {string} label  — для сообщения об ошибке
 * @returns {{ path, mime }}
 * @throws {RunwayError}
 */
function validateFile(filePath, label) {
  if (!filePath) return null;
  if (!fs.existsSync(filePath)) throw new RunwayError(`Файл не найден (${label}): ${filePath}`);
  const stat = fs.statSync(filePath);
  if (stat.size === 0) throw new RunwayError(`Пустой файл (${label}): ${filePath}`);
  // base64 увеличивает размер на ~33%; проверяем binary ≤ MAX_BINARY_BYTES
  if (stat.size > MAX_BINARY_BYTES) {
    const mb = (stat.size / 1024 / 1024).toFixed(2);
    throw new RunwayError(`Файл слишком большой (${label}): ${mb} МБ. ` +
      `Максимум ${(MAX_BINARY_BYTES / 1024 / 1024).toFixed(1)} МБ (base64 +33%).`);
  }
  const raw = fs.readFileSync(filePath);
  const mime = detectMime(raw);
  if (!mime) {
    const ext = path.extname(filePath).toLowerCase();
    throw new RunwayError(
      `Неподдерживаемый формат (${label}${ext ? ': ' + ext : ''}). Допустимы: JPEG, PNG, WebP.`
    );
  }
  return { path: filePath, mime };
}

/**
 * @param {string} apiKey
 * @throws {RunwayError}
 */
function validateApiKey(apiKey) {
  if (!apiKey) throw new RunwayError('RUNWAY_API_KEY не задан в окружении');
}

// ─── Core logic ────────────────────────────────────────────────────────────────

/**
 * Основная функция. Принимает fetch и AbortSignal извне — это позволяет
 * тестам подменять сеть без monkey-patching глобальных объектов.
 *
 * @param {object} opts
 * @param {string}   opts.apiKey
 * @param {string}   opts.sourcePath   — путь к фото человека
 * @param {string}   opts.userPrompt   — что изменить
 * @param {string}   [opts.refPath]    — путь к style-референсу
 * @param {string}   [opts.format]     — square|story|post
 * @param {number}   [opts.timeoutMs]  — общий таймаут (deadline вычисляется 1 раз)
 * @param {function} [opts.fetchFn]    — подменяемый fetch (для тестов)
 * @param {AbortSignal} [opts.signal]  — внешний AbortSignal (для cancel)
 * @param {number}   [opts.pollIntervalMs] — интервал polling (default 3000)
 * @returns {Promise<{ outputPath: string, taskId: string }>}
 */
async function runEdit({ apiKey, sourcePath, userPrompt, refPath,
                        format = 'story', timeoutMs = 180_000,
                        fetchFn = globalThis.fetch.bind(globalThis),
                        signal,
                        pollIntervalMs = 3000 }) {
  const sourceInfo = validateFile(sourcePath, '--source');
  const refInfo = refPath ? validateFile(refPath, '--reference') : null;
  validateApiKey(apiKey);

  if (!RATIOS[format]) throw new RunwayError(
    `Неизвестный формат: ${format}. Допустимы: ${Object.keys(RATIOS).join(', ')}`
  );

  // ── Build request body ──────────────────────────────────────────────────────

  const sourceB64 = fs.readFileSync(sourcePath).toString('base64');
  const sourceDataUri = `data:${sourceInfo.mime};base64,${sourceB64}`;

  if (Buffer.byteLength(sourceDataUri, 'utf8') > MAX_URI_BYTES) {
    throw new RunwayError(
      `Фото слишком велико для data URI (${MAX_URI_BYTES / 1024 / 1024} МБ лимит).`
    );
  }

  /** @type {Array<{uri: string, tag: string}>} */
  const referenceImages = [{ uri: sourceDataUri, tag: 'person' }];

  if (refInfo) {
    const refB64 = fs.readFileSync(refPath).toString('base64');
    const refDataUri = `data:${refInfo.mime};base64,${refB64}`;
    if (Buffer.byteLength(refDataUri, 'utf8') > MAX_URI_BYTES) {
      throw new RunwayError(
        `Референс слишком велик для data URI (${MAX_URI_BYTES / 1024 / 1024} МБ лимит).`
      );
    }
    referenceImages.push({ uri: refDataUri, tag: 'style' });
  }

  // Промпт: @person → лицо/внешность, @style → композиция/освещение/палитра
  const identityConstraint = refInfo
    ? 'Take the person\'s identity and face EXACTLY from @person. Do NOT copy the face from @style. ' +
      'Use @style only for composition, lighting, color palette and environment. ' +
      'Keep the person\'s exact facial features, skin texture, expression and proportions. ' +
      'Do not copy text, logos or watermarks from any reference.'
    : 'Take the person\'s identity and face EXACTLY from @person. ' +
      'Keep the person\'s exact facial features, skin texture, expression and proportions. ' +
      'Do not copy text, logos or watermarks.';

  const promptText = `${identityConstraint} ${userPrompt}`.trim();

  // ── Headers ────────────────────────────────────────────────────────────────
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'X-Runway-Version': API_VERSION,
  };

  // ── Single unified AbortController + one-time deadline ───────────────────────
  // deadline вычисляется ОДИН раз, до POST, и действует на все стадии:
  // POST → polling sleep → polling GET → download.
  // Таймер вызывает controller.abort() при срабатывании.
  // finally очищает таймер и listener внешнего signal.

  const controller = new AbortController();
  const deadline = Date.now() + timeoutMs;   // ОДИН раз, не пересчитывается
  let taskId = null;
  let timerId = null;
  let timedOut = false;  // true when timer fires — checked before "Прервано"

  function armTimer() {
    clearTimeout(timerId);
    const remaining = deadline - Date.now();
    if (remaining > 0) timerId = setTimeout(() => { timedOut = true; controller.abort(); }, remaining);
  }

  // Именованный обработчик — нужен для корректного removeEventListener
  const onAbort = () => controller.abort();

  // Внешний signal → внутренний controller
  if (signal) {
    if (signal.aborted) { clearTimeout(timerId); throw new RunwayError('Прервано перед запросом'); }
    signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    // ── Create task ────────────────────────────────────────────────────────
    armTimer();
    let createRes;
    try {
      createRes = await fetchFn(`${API_BASE}/text_to_image`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'gen4_image',
          promptText,
          ratio: RATIOS[format],
          referenceImages,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') throw new RunwayError('Сеть прервана (AbortError) при создании задачи', taskId);
      throw new RunwayError(`Сеть при создании задачи: ${err.message}`);
    }

    let taskBody;
    try { taskBody = await createRes.json(); } catch { /* ignore */ }
    if (!createRes.ok) {
      throw new RunwayError(
        `Runway API error ${createRes.status}: ${JSON.stringify(taskBody || createRes.statusText)}`,
        taskId
      );
    }

    taskId = taskBody?.id;
    if (!taskId) throw new RunwayError('Runway не вернул task ID');

    // ── Poll for completion ───────────────────────────────────────────────
    // deadline уже вычислен; если время вышло — бросаем сразу,
    // используя node:timers/promises sleep с AbortSignal.
    let outputUrl;
    while (true) {
      if (controller.signal.aborted) {
        const reason = Date.now() >= deadline ? 'Таймаут' : 'Прервано';
        throw new RunwayError(`${reason} во время polling`, taskId);
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new RunwayError(
          `Таймаут (${Math.round(timeoutMs / 1000)}с) ожидания результата Runway. ` +
          `Task ID: ${taskId}. Задача на стороне Runway продолжает выполняться и может завершиться позже.`,
          taskId
        );
      }

      const sleepMs = Math.min(pollIntervalMs, remaining);

      // node:timers/promises.setTimeout aborts when controller is aborted.
      // AbortError means external abort. timedOut flag distinguishes timer from external.
      try {
        await sleep(sleepMs, undefined, { signal: controller.signal });
      } catch (e) {
        if (e.name === 'AbortError') {
          if (timedOut) {
            throw new RunwayError(
              `Таймаут (${Math.round(timeoutMs / 1000)}с) ожидания результата Runway. ` +
              `Task ID: ${taskId}. Задача на стороне Runway продолжает выполняться и может завершиться позже.`,
              taskId
            );
          }
          throw new RunwayError('Прервано во время polling', taskId);
        }
        throw e;
      }

      let statusRes;
      try {
        statusRes = await fetchFn(`${API_BASE}/tasks/${taskId}`, {
          method: 'GET',
          headers,
          signal: controller.signal,
        });
      } catch (err) {
        if (err.name === 'AbortError') throw new RunwayError('Сеть прервана (AbortError) при проверке статуса', taskId);
        throw new RunwayError(`Сеть при проверке статуса: ${err.message}`, taskId);
      }

      if (!statusRes.ok) throw new RunwayError(`Polling HTTP ${statusRes.status}`, taskId);

      let statusBody;
      try { statusBody = await statusRes.json(); } catch { /* ignore */ }

      if (statusBody?.status === 'SUCCEEDED') {
        outputUrl = (statusBody.output || [])[0];
        break;
      }
      if (statusBody?.status === 'FAILED') {
        throw new RunwayError(
          `Runway: задача не удалась — ${statusBody.failure || statusBody.failureCode || 'без описания'}`,
          taskId
        );
      }
      if (statusBody?.status === 'CANCELLED') {
        throw new RunwayError('Runway: задача отменена', taskId);
      }
      // PENDING / RUNNING — continue polling
    }

    if (!outputUrl) throw new RunwayError('internal: no outputUrl after success', taskId);

    // ── Download result ───────────────────────────────────────────────────
    let imageRes;
    try {
      imageRes = await fetchFn(outputUrl, { signal: controller.signal });
    } catch (err) {
      if (err.name === 'AbortError') throw new RunwayError('Сеть прервана при скачивании', taskId);
      throw new RunwayError(`Не удалось скачать результат: ${err.message}`, taskId);
    }
    if (!imageRes.ok) throw new RunwayError(`Download failed HTTP ${imageRes.status}`, taskId);

    const rawBytes = new Uint8Array(await imageRes.arrayBuffer());
    if (rawBytes.length === 0) throw new RunwayError('Runway вернул пустой файл', taskId);

    // MIME определяется по байтам, НЕ по Content-Type:
    // HTML под видом image/png будет отклонён.
    const mime = detectMime(rawBytes);
    if (!mime) {
      const ct = imageRes.headers.get('content-type') || '';
      throw new RunwayError(`Runway вернул не изображение (Content-Type: ${ct})`, taskId);
    }

    const ext = MIME_TO_EXT[mime] || 'bin';
    const outputPath = path.join('/tmp', `runway_identity_${Date.now()}_${process.pid}.${ext}`);
    fs.writeFileSync(outputPath, Buffer.from(rawBytes));
    return { outputPath, taskId };

  } finally {
    clearTimeout(timerId);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

// ─── CLI entry point (only when run directly) ─────────────────────────────────

const IS_TESTING = process.env.NODE_ENV === 'test'
                || process.argv[1]?.includes('edit_identity_runway.test');

if (!IS_TESTING && require.main === module) {
  const { values } = parseArgs({
    options: {
      source:    { type: 'string', short: 's' },
      reference: { type: 'string', short: 'r' },
      prompt:    { type: 'string', short: 'p' },
      format:    { type: 'string', short: 'f', default: 'story' },
      timeout:   { type: 'string', default: '180000' },
    },
    allowPositionals: false,
  });

  const sourceFile = values.source;
  const referenceFile = values.reference;
  const userPrompt = values.prompt;

  if (!sourceFile) fail('Обязательный аргумент: --source <фото>');
  if (!userPrompt) fail('Обязательный аргумент: --prompt "<описание изменений>"');

  const apiKey = process.env.RUNWAY_API_KEY;
  const timeoutMs = Math.min(Number(values.timeout) || 180_000, 300_000);

  runEdit({ apiKey, sourcePath: sourceFile, userPrompt, refPath: referenceFile,
            format: values.format, timeoutMs })
    .then(({ outputPath }) => console.log(outputPath))
    .catch(err => {
      if (err instanceof RunwayError) {
        console.error(err.message + (err.taskId ? ` (task: ${err.taskId})` : ''));
      } else {
        console.error(err.message || String(err));
      }
      process.exit(1);
    });
}

module.exports = { runEdit, validateFile, validateApiKey, detectMime, RATIOS, MIME_TO_EXT };
