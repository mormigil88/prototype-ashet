// Тесты generate_tts_audio.js — HeyGen TTS API (без видео).
 // Запуск: node --test tests/generate_tts_audio.test.js
 //
 // parseArgs тестируется напрямую (чистая функция, без side effects).
 // synthesizeVoice/downloadAudio тестируются через subprocess wrapper script,
 // чтобы не мокать require()-кэш модуля.

 const test   = require('node:test');
 const assert = require('node:assert');
 const fs     = require('fs');
 const path   = require('path');
 const os     = require('os');

 const TEST_DIR    = path.join(os.tmpdir(), `tts-test-${process.pid}`);
 const REG_DIR     = path.join(TEST_DIR, 'heygen');
 const MODULE_PATH = path.join(__dirname, '..', 'generate_tts_audio.js');

 // ─── Helpers ────────────────────────────────────────────────────────────────

 /** Записывает и запускает wrapper-скрипт, возвращает { status, stdout, stderr } */
 function runWrapper(wrapCode) {
   const { spawnSync } = require('child_process');
   const wrapPath = path.join(TEST_DIR, 'wrap.js');
   fs.writeFileSync(wrapPath, wrapCode, 'utf8');
   const env = {
     ...process.env,
     HEYGEN_API_KEY:      'test-key',
     HEYGEN_REGISTRY_DIR: REG_DIR,
     CLIENT_SLUG:         'ashet-irina',
   };
   return spawnSync('node', [wrapPath], {
     env,
     encoding: 'utf8',
     stdio: ['pipe', 'pipe', 'pipe'],
   });
 }

 // ─── Setup ─────────────────────────────────────────────────────────────────

 test.beforeEach(() => {
   fs.mkdirSync(REG_DIR, { recursive: true });
   const reg = {
     version: 1, updated_at: new Date().toISOString(),
     avatars: [{
       id: 'av-test', alias: 'основной', name: 'Test Avatar',
       type: 'digital_twin', status: 'active',
       avatar_id: 'avatar-test-123', voice_id: 'voice-test-789',
       created_at: new Date().toISOString(), last_verified_at: new Date().toISOString(),
     }],
     default_alias: 'основной',
   };
   fs.writeFileSync(path.join(REG_DIR, 'avatar_registry.json'), JSON.stringify(reg));
 });

 test.afterEach(() => {
   try { fs.rmSync(TEST_DIR, { recursive: true }); } catch {}
 });

 // ─── parseArgs tests ─────────────────────────────────────────────────────────

 test('parseArgs: script only', () => {
   const { parseArgs } = require('../generate_tts_audio.js');
   const r = parseArgs(['node', 'script', 'Hello world']);
   assert.strictEqual(r.script, 'Hello world');
   assert.strictEqual(r.voiceId, null);
   assert.strictEqual(r.speed, 1.0);
 });

 test('parseArgs: --speed', () => {
   const { parseArgs } = require('../generate_tts_audio.js');
   const r = parseArgs(['node', 's', '--speed', '1.5', 'Hi']);
   assert.strictEqual(r.speed, 1.5);
 });

 test('parseArgs: --voice-id', () => {
   const { parseArgs } = require('../generate_tts_audio.js');
   const r = parseArgs(['node', 's', '--voice-id', 'vid-abc', 'Text']);
   assert.strictEqual(r.voiceId, 'vid-abc');
 });

 // ─── synthesizeVoice + downloadAudio (subprocess) ──────────────────────────

 test('TTS: synthesizeVoice → audio_url, no key leaked', () => {
   const r = runWrapper(`
global.fetch = (url) => {
  const u = typeof url === 'string' ? url : (url.url || '');
  if (u.includes('/v3/voices/speech')) {
    return Promise.resolve({
      ok: true, status: 200,
      async json() { return { data: { audio_url: 'https://heygen.ai/tts/test.mp3', duration: 2.5, request_id: 'req-abc' } }; },
    });
  }
  if (u.includes('/tts/test.mp3')) {
    return Promise.resolve({ ok: true, status: 200, async arrayBuffer() { return Buffer.from([0xFF, 0xFB]); } });
  }
  throw new Error('unexpected fetch: ' + u);
};
const { synthesizeVoice } = require('${MODULE_PATH}');
async function run() {
  const result = await synthesizeVoice('voice-test-789', 'Привет мир', 1.0);
  process.stdout.write(JSON.stringify(result));
}
run().catch(e => { console.error(e.message); process.exit(1); });
   `);

   assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
   const parsed = JSON.parse(r.stdout.trim());
   assert.strictEqual(parsed.audioUrl, 'https://heygen.ai/tts/test.mp3');
   assert.strictEqual(parsed.duration, 2.5);
   assert.ok(!r.stderr.includes('test-key'), 'API key leaked');
 });

 test('TTS: HeyGen 400 error → fail, no key leaked', () => {
   const r = runWrapper(`
global.fetch = () => Promise.resolve({
  ok: false, status: 400,
  async json() { return { error: { message: 'Invalid voice_id' } }; },
});
const { synthesizeVoice } = require('${MODULE_PATH}');
synthesizeVoice('bad-voice', 'Hello', 1.0)
  .then(() => process.exit(0))
  .catch(e => { console.error(e.message); process.exit(1); });
   `);

   assert.notStrictEqual(r.status, 0);
   assert.ok(r.stderr.includes('Invalid voice_id'));
   assert.ok(!r.stderr.includes('test-key'));
   assert.ok(!r.stderr.includes('bad-voice'));
 });

 test('TTS: audio download 500 → fail', () => {
   const r = runWrapper(`
global.fetch = (url) => {
  const u = typeof url === 'string' ? url : (url.url || '');
  if (u.includes('/v3/voices/speech')) {
    return Promise.resolve({
      ok: true, status: 200,
      async json() { return { data: { audio_url: 'https://heygen.ai/tts/bad.mp3', duration: 1.0, request_id: 'req-bad' } }; },
    });
  }
  return Promise.resolve({ ok: false, status: 500 });
};
const { synthesizeVoice, downloadAudio } = require('${MODULE_PATH}');
async function run() {
  const tts = await synthesizeVoice('voice-ok', 'Hello', 1.0);
  await downloadAudio(tts.audioUrl);
}
run().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
   `);

   assert.notStrictEqual(r.status, 0);
   assert.ok(
     r.stderr.includes('500') || r.stderr.includes('скачать'),
     `Expected 500 or скачать, got: ${r.stderr}`
   );
 });

 test('TTS: missing API key → fail', () => {
   const { spawnSync } = require('child_process');
   const env = { ...process.env };
   delete env.HEYGEN_API_KEY;
   const r = spawnSync('node', ['-e', `
const { synthesizeVoice } = require('${MODULE_PATH}');
synthesizeVoice('vid', 'Hi').then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
   `], {
     env,
     encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
   });
   assert.notStrictEqual(r.status, 0);
   assert.ok(r.stderr.includes('HEYGEN_API_KEY'));
 });
