/**
 * edit_identity_runway.test.js — Node.js native test suite.
 * Запускается:  node --test edit_identity_runway.test.js
 * Или inline runner: node -e "require('./edit_identity_runway.test.js')"
 */
'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { runEdit, validateFile, detectMime, RATIOS, MIME_TO_EXT } = require('./edit_identity_runway');

// ─── Real binary fixtures ───────────────────────────────────────────────────────
// Minimal JPEG (1×1 red pixel)
const JPEG_1X1 = Buffer.from([
  0xFF,0xD8,0xFF,0xE0,0x00,0x10,0x4A,0x46,0x49,0x46,0x00,0x01,0x01,0x00,0x00,0x01,
  0x00,0x01,0x00,0x00,0xFF,0xDB,0x00,0x43,0x00,0x08,0x06,0x06,0x07,0x06,0x05,0x08,
  0x07,0x07,0x07,0x09,0x09,0x08,0x0A,0x0C,0x14,0x0D,0x0C,0x0B,0x0B,0x0C,0x19,0x12,
  0x13,0x0F,0x14,0x1D,0x1A,0x1F,0x1E,0x1D,0x1A,0x1C,0x1C,0x20,0x24,0x2E,0x27,0x20,
  0x22,0x2C,0x23,0x1C,0x1C,0x28,0x37,0x29,0x2C,0x30,0x31,0x34,0x34,0x34,0x1F,0x27,
  0x39,0x3D,0x38,0x32,0x3C,0x2E,0x33,0x34,0x32,0xFF,0xC0,0x00,0x0B,0x08,0x00,0x01,
  0x00,0x01,0x01,0x01,0x11,0x00,0xFF,0xC4,0x00,0x1F,0x00,0x00,0x01,0x05,0x01,0x01,
  0x01,0x01,0x01,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x01,0x02,0x03,0x04,
  0x05,0x06,0x07,0x08,0x09,0x0A,0x0B,0xFF,0xC4,0x00,0xB5,0x10,0x00,0x02,0x01,0x03,
  0x03,0x02,0x04,0x03,0x05,0x05,0x04,0x04,0x00,0x00,0x01,0x7D,0x01,0x02,0x03,0x00,
  0x04,0x11,0x05,0x12,0x21,0x31,0x41,0x06,0x13,0x51,0x61,0x07,0x22,0x71,0x14,0x32,
  0x81,0x91,0xA1,0x08,0x23,0x42,0xB1,0xC1,0x15,0x52,0xD1,0xF0,0x24,0x33,0x62,0x72,
  0x82,0x09,0x0A,0x16,0x17,0x18,0x19,0x1A,0x25,0x26,0x27,0x28,0x29,0x2A,0x34,0x35,
  0x36,0x37,0x38,0x39,0x3A,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4A,0x53,0x54,0x55,
  0x56,0x57,0x58,0x59,0x5A,0x63,0x64,0x65,0x66,0x67,0x68,0x69,0x6A,0x73,0x74,0x75,
  0x76,0x77,0x78,0x79,0x7A,0x83,0x84,0x85,0x86,0x87,0x88,0x89,0x8A,0x92,0x93,0x94,
  0x95,0x96,0x97,0x98,0x99,0x9A,0xA2,0xA3,0xA4,0xA5,0xA6,0xA7,0xA8,0xA9,0xAA,0xB2,
  0xB3,0xB4,0xB5,0xB6,0xB7,0xB8,0xB9,0xBA,0xC2,0xC3,0xC4,0xC5,0xC6,0xC7,0xC8,0xC9,
  0xCA,0xD2,0xD3,0xD4,0xD5,0xD6,0xD7,0xD8,0xD9,0xDA,0xE1,0xE2,0xE3,0xE4,0xE5,0xE6,
  0xE7,0xE8,0xE9,0xEA,0xF1,0xF2,0xF3,0xF4,0xF5,0xF6,0xF7,0xF8,0xF9,0xFA,0xFF,0xDA,
  0x00,0x08,0x01,0x01,0x00,0x00,0x3F,0x00,0xFB,0xD5,0xDB,0x20,0xA8,0xF1,0x7F,0xFF,0xD9
]);

// Minimal PNG 1×1 (gray)
const PNG_1X1 = Buffer.from([
  0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,0x00,0x00,0x00,0x0D,0x49,0x48,0x44,0x52,
  0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,0x08,0x06,0x00,0x00,0x00,0x1F,0x15,0xC4,0x89,
  0x00,0x00,0x00,0x0A,0x49,0x44,0x41,0x54,0x78,0x9C,0x63,0x00,0x01,0x00,0x00,0x05,
  0x00,0x01,0x0D,0x0A,0x2D,0xB4,0x00,0x00,0x00,0x00,0x49,0x45,0x4E,0x44,0xAE,0x42,0x60,0x82
]);

// Minimal WebP 1×1 (lossy)
const WEBP_1X1 = Buffer.from([
  0x52,0x49,0x46,0x46,0x1C,0x00,0x00,0x00,0x57,0x45,0x42,0x50,0x50,0x56,0x0C,0x00,
  0x00,0x00,0x0C,0x00,0x00,0x00,0x01,0x00,0x00,0x00,0xAB,0x90,0x03,0x00,0x00,0x00,0x00
]);

// HTML content
const HTML_CONTENT = Buffer.from('<html><body>Not Found</body></html>');

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const FIXTURES = path.join('/tmp', 'eir_fixtures');

function ensureFixtures() {
  if (!fs.existsSync(FIXTURES)) fs.mkdirSync(FIXTURES, { recursive: true });
  fs.writeFileSync(path.join(FIXTURES, 'person.jpg'),  JPEG_1X1);
  fs.writeFileSync(path.join(FIXTURES, 'person.png'),  PNG_1X1);
  fs.writeFileSync(path.join(FIXTURES, 'style.jpg'),   JPEG_1X1);
  fs.writeFileSync(path.join(FIXTURES, 'style.png'),   PNG_1X1);
  return {
    personJpg: path.join(FIXTURES, 'person.jpg'),
    personPng: path.join(FIXTURES, 'person.png'),
    styleJpg:  path.join(FIXTURES, 'style.jpg'),
    stylePng:  path.join(FIXTURES, 'style.png'),
  };
}

function fp(name) { return path.join(FIXTURES, name); }

// ─── Capture fetch helper ───────────────────────────────────────────────────────
// Mock fetchFn that captures POST body and simulates a full success path.
// GET /tasks/ returns SUCCEEDED so polling exits and download is attempted.

function makeCaptureFetch(imageBytes = PNG_1X1) {
  let captured = null;
  const fn = async (url, opts = {}) => {
    if (url.includes('/text_to_image') && opts.method === 'POST') {
      captured = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({ id: 'test_task_001' }) };
    }
    if (url.match(/\/tasks\/[\w-]+$/) && opts.method === 'GET') {
      return {
        ok: true, status: 200,
        headers: new Map([['content-type', 'image/png']]),
        json: async () => ({ status: 'SUCCEEDED', output: ['https://example.com/result.png'] }),
        arrayBuffer: async () => imageBytes,
      };
    }
    // download
    return {
      ok: true, status: 200,
      headers: new Map([['content-type', 'image/png']]),
      arrayBuffer: async () => imageBytes,
    };
  };
  return { fn, get: () => captured };
}

beforeEach(() => ensureFixtures());

// ══════════════════════════════════════════════════════════════════════════════
// 1. detectMime — byte signature
// ══════════════════════════════════════════════════════════════════════════════

test('detectMime — JPEG: FF D8 FF', () => {
  assert.strictEqual(detectMime(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0])), 'image/jpeg');
  assert.strictEqual(detectMime(JPEG_1X1), 'image/jpeg');
});

test('detectMime — PNG: full 8-byte signature', () => {
  assert.strictEqual(detectMime(PNG_1X1), 'image/png');
  // Partial (too short) → null
  assert.strictEqual(detectMime(Buffer.from([0x89, 0x50, 0x4E, 0x47])), null);
  // Wrong 5th byte
  assert.strictEqual(detectMime(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0xFF, 0x1A, 0x0A])), null);
});

test('detectMime — WebP: RIFF....WEBP', () => {
  assert.strictEqual(detectMime(WEBP_1X1), 'image/webp');
  // RIFF but not WEBP
  const riffNotWebp = Buffer.from([0x52,0x49,0x46,0x46,0x00,0x00,0x00,0x00,0x41,0x42,0x43,0x44]);
  assert.strictEqual(detectMime(riffNotWebp), null);
});

test('detectMime — unknown → null', () => {
  assert.strictEqual(detectMime(Buffer.from('hello')), null);
  assert.strictEqual(detectMime(HTML_CONTENT), null);
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. validateFile — format by bytes, not by extension
// ══════════════════════════════════════════════════════════════════════════════

test('validateFile — JPEG by bytes even if .png extension', () => {
  const f = fp('misnamed.png');
  fs.writeFileSync(f, JPEG_1X1);
  const r = validateFile(f, 't');
  assert.strictEqual(r.mime, 'image/jpeg', 'MIME is jpeg, not png');
  fs.unlinkSync(f);
});

test('validateFile — PNG by bytes even if .jpg extension', () => {
  const f = fp('misnamed.jpg');
  fs.writeFileSync(f, PNG_1X1);
  const r = validateFile(f, 't');
  assert.strictEqual(r.mime, 'image/png', 'MIME is png, not jpeg');
  fs.unlinkSync(f);
});

test('validateFile — WebP accepted (.txt extension)', () => {
  const f = fp('img.txt');
  fs.writeFileSync(f, WEBP_1X1);
  const r = validateFile(f, 't');
  assert.strictEqual(r.mime, 'image/webp');
  fs.unlinkSync(f);
});

test('validateFile — rejects non-image (HTML)', async () => {
  const f = fp('fake.html');
  fs.writeFileSync(f, HTML_CONTENT);
  try {
    await validateFile(f, 't');
    assert.fail('expected RunwayError');
  } catch (e) {
    assert.ok(e.message.includes('Неподдерживаемый формат'));
  }
  fs.unlinkSync(f);
});

test('validateFile — missing file', async () => {
  try {
    await validateFile('/nope/file.jpg', 't');
    assert.fail('expected RunwayError');
  } catch (e) {
    assert.ok(e.message.includes('Файл не найден'));
  }
});

test('validateFile — empty file', async () => {
  const f = fp('empty.jpg');
  fs.writeFileSync(f, Buffer.alloc(0));
  try {
    await validateFile(f, 't');
    assert.fail('expected RunwayError');
  } catch (e) {
    assert.ok(e.message.includes('Пустой файл'));
  }
  fs.unlinkSync(f);
});

test('validateFile — too large (>3.69 MB binary)', async () => {
  const f = fp('large.bin');
  fs.writeFileSync(f, Buffer.alloc(4 * 1024 * 1024));
  try {
    await validateFile(f, 't');
    assert.fail('expected RunwayError');
  } catch (e) {
    assert.ok(e.message.includes('слишком большой'));
  }
  fs.unlinkSync(f);
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. validateFile + runEdit use real MIME fixtures
// ══════════════════════════════════════════════════════════════════════════════

test('JPEG fixture → data URI with image/jpeg', async () => {
  const { fn, get } = makeCaptureFetch(PNG_1X1);
  const { personJpg } = ensureFixtures();
  await runEdit({ apiKey: 'k', sourcePath: personJpg, userPrompt: 'x', fetchFn: fn });
  const body = get();
  assert.ok(body.referenceImages[0].uri.startsWith('data:image/jpeg;base64,'));
});

test('PNG fixture → data URI with image/png', async () => {
  const { fn, get } = makeCaptureFetch(PNG_1X1);
  const { personPng } = ensureFixtures();
  await runEdit({ apiKey: 'k', sourcePath: personPng, userPrompt: 'x', fetchFn: fn });
  const body = get();
  assert.ok(body.referenceImages[0].uri.startsWith('data:image/png;base64,'));
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. @person and @style roles
// ══════════════════════════════════════════════════════════════════════════════

test('@person + @style: both in prompt, prohibition, correct tags', async () => {
  const { fn, get } = makeCaptureFetch();
  const { personJpg, styleJpg } = ensureFixtures();
  await runEdit({ apiKey: 'k', sourcePath: personJpg, refPath: styleJpg,
                  userPrompt: 'add sunset', fetchFn: fn });
  const body = get();
  assert.ok(body.promptText.includes('@person'));
  assert.ok(body.promptText.includes('@style'));
  assert.ok(body.promptText.includes('Do NOT copy the face from @style'));
  assert.ok(body.promptText.includes('identity and face EXACTLY from @person'));
  assert.ok(body.referenceImages.some(r => r.tag === 'person'));
  assert.ok(body.referenceImages.some(r => r.tag === 'style'));
});

test('@person only: no @style, single referenceImage', async () => {
  const { fn, get } = makeCaptureFetch();
  const { personJpg } = ensureFixtures();
  await runEdit({ apiKey: 'k', sourcePath: personJpg, userPrompt: 'lighten', fetchFn: fn });
  const body = get();
  assert.ok(!body.promptText.includes('@style'));
  assert.ok(body.promptText.includes('@person'));
  assert.strictEqual(body.referenceImages.length, 1);
  assert.strictEqual(body.referenceImages[0].tag, 'person');
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. HTML rejected even with image/png Content-Type (byte signature check)
// ══════════════════════════════════════════════════════════════════════════════

test('HTML with image/png Content-Type → RunwayError (byte signature)', async () => {
  const { personJpg } = ensureFixtures();
  const htmlBytes = Buffer.from('<html>Not Found</html>');

  await assert.rejects(
    runEdit({
      apiKey: 'k', sourcePath: personJpg, userPrompt: 'x',
      fetchFn: async (url, opts) => {
        if (opts.method === 'POST') return { ok: true, status: 200, json: async () => ({ id: 'task_html' }) };
        // GET /tasks/ — return SUCCEEDED so polling exits and download is reached
        if (url.match(/\/tasks\//)) {
          return {
            ok: true, status: 200,
            headers: new Map([['content-type', 'image/png']]),
            json: async () => ({ status: 'SUCCEEDED', output: ['https://example.com/result.png'] }),
            arrayBuffer: async () => htmlBytes,
          };
        }
        // download: lies about content-type, returns HTML bytes
        return {
          ok: true, status: 200,
          headers: new Map([['content-type', 'image/png']]),
          arrayBuffer: async () => htmlBytes,
        };
      },
    }),
    /Runway вернул не изображение/
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. Timeout: single deadline, task ID in error
// ══════════════════════════════════════════════════════════════════════════════

test('timeout — deadline fires, task ID in err.taskId (not regex)', async () => {
  const { personJpg } = ensureFixtures();
  let caughtErr = null;

  await assert.rejects(
    runEdit({
      apiKey: 'k', sourcePath: personJpg, userPrompt: 'x',
      timeoutMs: 10,
      pollIntervalMs: 5000,
      fetchFn: async (url, opts) => {
        if (opts.method === 'POST') return { ok: true, status: 200, json: async () => ({ id: 'task_timeout' }) };
        return { ok: true, status: 200, json: async () => ({ status: 'RUNNING' }) };
      },
    }),
    (err) => { caughtErr = err; return true; }
  );

  // Check taskId PROPERTY directly
  assert.strictEqual(caughtErr.taskId, 'task_timeout',
    `taskId="${caughtErr.taskId}", want "task_timeout"`);
  assert.ok(caughtErr.message.includes('Таймаут'));
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. External AbortSignal during polling sleep
// ══════════════════════════════════════════════════════════════════════════════

test('external abort during polling → err.taskId preserved', async () => {
  const { personJpg } = ensureFixtures();
  const ac = new AbortController();

  const fetchFn = async (url, opts) => {
    if (opts.method === 'POST') return { ok: true, status: 200, json: async () => ({ id: 'task_abort' }) };
    if (opts.method === 'GET') {
      setTimeout(() => ac.abort(), 50);
      return { ok: true, status: 200, json: async () => ({ status: 'RUNNING' }) };
    }
    return { ok: true, status: 200, headers: new Map([['content-type','image/png']]), arrayBuffer: async () => PNG_1X1 };
  };

  let caughtErr = null;
  await assert.rejects(
    runEdit({ apiKey: 'k', sourcePath: personJpg, userPrompt: 'x',
              fetchFn, signal: ac.signal, timeoutMs: 20000, pollIntervalMs: 200 }),
    (err) => { caughtErr = err; return true; }
  );

  assert.strictEqual(caughtErr.taskId, 'task_abort',
    `taskId="${caughtErr.taskId}", want "task_abort"`);
  assert.ok(caughtErr.message.includes('Прервано'));
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. taskId preserved in ALL cancel/error paths after taskId obtained
// ══════════════════════════════════════════════════════════════════════════════

test('POST 500 after taskId → err.taskId preserved', async () => {
  const { personJpg } = ensureFixtures();
  let caughtErr = null;

  await assert.rejects(
    runEdit({
      apiKey: 'k', sourcePath: personJpg, userPrompt: 'x',
      fetchFn: async (url, opts) => {
        if (opts.method === 'POST') return { ok: true, status: 200, json: async () => ({ id: 'task_500' }) };
        return { ok: false, status: 500, json: async () => ({}) };
      },
      timeoutMs: 20000,
    }),
    (err) => { caughtErr = err; return true; }
  );

  assert.strictEqual(caughtErr.taskId, 'task_500');
});

test('polling HTTP 502 after taskId → err.taskId preserved', async () => {
  const { personJpg } = ensureFixtures();
  let caughtErr = null;

  await assert.rejects(
    runEdit({
      apiKey: 'k', sourcePath: personJpg, userPrompt: 'x',
      timeoutMs: 20000,
      fetchFn: async (url, opts) => {
        if (opts.method === 'POST') return { ok: true, status: 200, json: async () => ({ id: 'task_poll_fail' }) };
        return { ok: false, status: 502, json: async () => ({}) };
      },
    }),
    (err) => { caughtErr = err; return true; }
  );

  assert.strictEqual(caughtErr.taskId, 'task_poll_fail');
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. Stuck network — timer fires, exactly one POST
// ══════════════════════════════════════════════════════════════════════════════

test('stuck POST — timer fires, exactly one POST', async () => {
  const { personJpg } = ensureFixtures();
  let postCount = 0;

  const stuckFetch = async (url, opts) => {
    if (opts.method === 'POST') {
      postCount++;
      await new Promise((_, reject) => {
        opts.signal.addEventListener('abort', () => reject(new Error('AbortError')), { once: true });
      });
      throw new Error('AbortError');
    }
    return { ok: false };
  };

  await assert.rejects(
    runEdit({ apiKey: 'k', sourcePath: personJpg, userPrompt: 'x',
              fetchFn: stuckFetch, timeoutMs: 200 }),
    /AbortError/
  );
  assert.strictEqual(postCount, 1);
});

test('stuck download — timer fires, download hangs then aborts', async () => {
  const { personJpg } = ensureFixtures();
  let postCount = 0, dlCount = 0;

  const stuckFetch = async (url, opts) => {
    if (opts.method === 'POST') { postCount++; return { ok: true, status: 200, json: async () => ({ id: 'task_stuck_dl' }) }; }
    if (opts.method === 'GET') return { ok: true, status: 200, json: async () => ({ status: 'SUCCEEDED', output: ['data:image/png;base64,'] }) };
    dlCount++;
    await new Promise((_, reject) => {
      opts.signal.addEventListener('abort', () => reject(new Error('AbortError')), { once: true });
    });
    throw new Error('AbortError');
  };

  await assert.rejects(
    runEdit({ apiKey: 'k', sourcePath: personJpg, userPrompt: 'x',
              fetchFn: stuckFetch, timeoutMs: 200, pollIntervalMs: 50 }),
    /AbortError|task_stuck_dl/
  );
  assert.strictEqual(postCount, 1);
  assert.strictEqual(dlCount, 1);
});

// ══════════════════════════════════════════════════════════════════════════════
// 10. Image download — correct output extension by byte signature
// ══════════════════════════════════════════════════════════════════════════════

test('PNG saved with correct .png extension', async () => {
  const { fn } = makeCaptureFetch(PNG_1X1);
  const { personJpg } = ensureFixtures();
  const result = await runEdit({ apiKey: 'k', sourcePath: personJpg, userPrompt: 'x', fetchFn: fn });
  assert.ok(result.outputPath.endsWith('.png'));
  assert.ok(fs.existsSync(result.outputPath));
  fs.unlinkSync(result.outputPath);
});

test('JPEG saved as .jpg (byte-detected JPEG even if PNG Content-Type)', async () => {
  // Returns JPEG bytes but with PNG content-type header
  const { fn } = makeCaptureFetch(JPEG_1X1);
  const { personJpg } = ensureFixtures();
  const result = await runEdit({ apiKey: 'k', sourcePath: personJpg, userPrompt: 'x', fetchFn: fn });
  assert.ok(result.outputPath.endsWith('.jpg'), `want .jpg, got: ${result.outputPath}`);
  assert.ok(fs.statSync(result.outputPath).size > 0);
  fs.unlinkSync(result.outputPath);
});

test('WebP saved as .webp', async () => {
  const { fn } = makeCaptureFetch(WEBP_1X1);
  const { personJpg } = ensureFixtures();
  const result = await runEdit({ apiKey: 'k', sourcePath: personJpg, userPrompt: 'x', fetchFn: fn });
  assert.ok(result.outputPath.endsWith('.webp'), `want .webp, got: ${result.outputPath}`);
  assert.ok(fs.statSync(result.outputPath).size > 0);
  fs.unlinkSync(result.outputPath);
});

test('empty download buffer → RunwayError', async () => {
  const { personJpg } = ensureFixtures();
  let dlCount = 0;

  await assert.rejects(
    runEdit({
      apiKey: 'k', sourcePath: personJpg, userPrompt: 'x',
      pollIntervalMs: 100,
      fetchFn: async (url, opts) => {
        if (opts.method === 'POST') return { ok: true, status: 200, json: async () => ({ id: 't' }) };
        if (opts.method === 'GET') {
          // SUCCEEDED immediately so polling exits and download is reached
          return { ok: true, status: 200, json: async () => ({ status: 'SUCCEEDED', output: ['https://example.com/empty.png'] }) };
        }
        dlCount++;
        return { ok: true, status: 200, headers: new Map([['content-type','image/png']]), arrayBuffer: async () => Buffer.alloc(0) };
      },
    }),
    /Runway вернул пустой файл/
  );
  assert.strictEqual(dlCount, 1, 'download must be called exactly once');
});

// ══════════════════════════════════════════════════════════════════════════════
// 11. Unit: RATIOS, MIME_TO_EXT, missing API key
// ══════════════════════════════════════════════════════════════════════════════

test('RATIOS — square/story/post', () => {
  assert.deepStrictEqual(Object.keys(RATIOS).sort(), ['post', 'square', 'story']);
});

test('MIME_TO_EXT — jpeg/png/webp', () => {
  assert.strictEqual(MIME_TO_EXT['image/jpeg'], 'jpg');
  assert.strictEqual(MIME_TO_EXT['image/png'], 'png');
  assert.strictEqual(MIME_TO_EXT['image/webp'], 'webp');
});

test('missing API key — no network', async () => {
  const { personJpg } = ensureFixtures();
  let called = false;
  await assert.rejects(
    runEdit({ apiKey: '', sourcePath: personJpg, userPrompt: 'x',
              fetchFn: async () => { called = true; return { ok: false }; } }),
    /RUNWAY_API_KEY/
  );
  assert.strictEqual(called, false);
});
