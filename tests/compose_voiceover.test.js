// Тесты compose_voiceover.js — сборка видео из фото и озвучки.
 // Запуск: node --test tests/compose_voiceover.test.js
 //
 // Мокается: НЕ мокается (ffmpeg реальный в контейнере).
 // Тесты создают реальные TMP-файлы и проверяют выходной MP4.

 const test   = require('node:test');
 const assert = require('node:assert');
 const fs     = require('fs');
 const path   = require('path');
 const os     = require('os');
 const { execFileSync, spawnSync, spawn } = require('child_process');
 const { buildFfmpegArgs } = require('../compose_voiceover');

 const TEST_DIR = path.join(os.tmpdir(), `vo-test-${process.pid}`);

 // ─── Helpers ────────────────────────────────────────────────────────────────

 /** Создаёт минимальный PNG 1080×1920 (чёрный). */
 function createTestPng(width = 1080, height = 1920) {
   const out = path.join(TEST_DIR, `img_${Math.random().toString(36).slice(2, 6)}.png`);
   try {
     execFileSync('ffmpeg', [
       '-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:d=1`,
       '-frames:v', '1', '-y', out,
     ], { stdio: 'pipe' });
   } catch { /* ffmpeg может не быть в dev env */ }
   return out;
 }

 /** Создаёт минимальный MP3 (1 сек тишины). */
 function createTestMp3(durationSec = 3) {
   const out = path.join(TEST_DIR, `audio_${Math.random().toString(36).slice(2, 6)}.mp3`);
   try {
     execFileSync('ffmpeg', [
       '-f', 'lavfi', '-i', `anullsrc=r=44100:cl=stereo:d=${durationSec}`,
       '-ac', '2', '-b:a', '128k', '-y', out,
     ], { stdio: 'pipe' });
   } catch { /* ffmpeg может не быть в dev env */ }
   return out;
 }

 /** ffprobe duration */
 function getDuration(f) {
   try {
     const r = spawnSync('ffprobe', [
       '-v', 'error', '-show_entries', 'format=duration',
       '-of', 'csv=p=0', f,
     ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
     return parseFloat(r.stdout.trim()) || 0;
   } catch { return 0; }
 }

 function runScript(args) {
   return new Promise(resolve => {
     const log = [], err = [];
     const child = spawn('node', [
       path.join(__dirname, '..', 'compose_voiceover.js'),
       ...args,
     ], {
       env: { ...process.env },
       stdio: ['pipe', 'pipe', 'pipe'],
     });
     child.stdout.on('data', d => log.push(d.toString()));
     child.stderr.on('data', d => err.push(d.toString()));
     child.on('close', code => resolve({ code, stdout: log.join('').trim(), stderr: err.join('') }));
   });
 }

 test.beforeEach(() => {
   try { fs.mkdirSync(TEST_DIR, { recursive: true }); } catch {}
 });

 test.afterEach(() => {
   try { fs.rmSync(TEST_DIR, { recursive: true }); } catch {}
 });

 // ─── Тесты ─────────────────────────────────────────────────────────────────

 test('video input remains a moving stream with narration mapped separately', () => {
   const args = buildFfmpegArgs('/tmp/voice.mp3', '/tmp/out.mp4', ['/tmp/clip.mp4'],
     2, [{ isVideo: true, duration: 1 }]);
   assert.ok(args.includes('/tmp/clip.mp4'));
   assert.ok(!args.includes('-loop'), 'video must not become a still image');
   assert.ok(args.join(' ').includes('tpad=stop_mode=clone'));
   assert.deepStrictEqual(args.slice(args.indexOf('-map'), args.indexOf('-map') + 4),
     ['-map', '[vout]', '-map', '1:a:0']);
 });

 test('short narration allocates at least one frame to every image', () => {
   const files = Array.from({ length: 30 }, (_, i) => `/tmp/${i}.jpg`);
   const args = buildFfmpegArgs('/tmp/voice.mp3', '/tmp/out.mp4', files,
     1.03, files.map(() => ({ isVideo: false, duration: 0 })));
   const filter = args[args.indexOf('-filter_complex') + 1];
   const frameCounts = [...filter.matchAll(/trim=end_frame=(\d+)/g)].map(m => Number(m[1]));
   assert.strictEqual(frameCounts.length, 30);
   assert.ok(frameCounts.every(n => n >= 1));
   assert.strictEqual(frameCounts.reduce((a, b) => a + b, 0), 31);
 });

 test('video input with source audio maps only the narration track', (t) => {
   try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); }
   catch { t.skip('ffmpeg unavailable on this host'); return; }
   const mp3 = createTestMp3(2);
   const video = path.join(TEST_DIR, 'moving.mp4');
   const output = path.join(TEST_DIR, 'moving-vo.mp4');
   execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
     'testsrc2=size=160x284:rate=30:duration=2', '-f', 'lavfi', '-i',
     'sine=frequency=700:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
     '-c:a', 'aac', '-shortest', '-y', video]);
   return runScript([mp3, output, '--video', video]).then(({ code, stderr }) => {
     assert.strictEqual(code, 0, stderr);
     assert.ok(getDuration(output) >= 1.8);
     const frameHash = time => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error',
       '-ss', String(time), '-i', output, '-frames:v', '1', '-f', 'md5', '-'],
     { encoding: 'utf8' }).trim();
     assert.notStrictEqual(frameHash(0.2), frameHash(1.2), 'video motion was lost');
   });
 });

 test('FFmpeg available — skip if missing', (t) => {
   try {
     execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
   } catch {
     t.skip('ffmpeg unavailable on this host');
   }
 });

 test('output MP4 created from photo + MP3', async (t) => {
   // Пропускаем если ffmpeg не доступен в dev
   let hasFfmpeg = false;
   try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); hasFfmpeg = true; } catch {}
   if (!hasFfmpeg) { t.skip('ffmpeg unavailable on this host'); return; }

   const mp3 = createTestMp3(3);
   const png = createTestPng();
   const out = path.join(TEST_DIR, 'out.mp4');

   if (!fs.existsSync(mp3) || !fs.existsSync(png)) {
     t.skip('test input generation failed'); return;
   }

   const { code, stderr } = await runScript([mp3, out, png]);

   assert.strictEqual(code, 0, `ffmpeg error: ${stderr}`);
   assert.ok(fs.existsSync(out), 'output MP4 should exist');
   assert.ok(out.endsWith('.mp4'));

   const dur = getDuration(out);
   assert.ok(dur >= 2.5, `Duration should be ~3s, got ${dur}`);
 });

 test('error: no media files', async (t) => {
   let hasFfmpeg = false;
   try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); hasFfmpeg = true; } catch {}
   if (!hasFfmpeg) { t.skip('ffmpeg unavailable on this host'); return; }

   const mp3 = createTestMp3(1);
   if (!fs.existsSync(mp3)) { t.skip('test input generation failed'); return; }

   const { code, stderr } = await runScript([mp3, '/tmp/nonexist.mp4']);
   assert.notStrictEqual(code, 0);
   assert.ok(stderr.includes('нет медиа') || stderr.includes('Нет медиа'));
 });

 test('error: missing audio', async (t) => {
   let hasFfmpeg = false;
   try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); hasFfmpeg = true; } catch {}
   if (!hasFfmpeg) { t.skip('ffmpeg unavailable on this host'); return; }

   const png = createTestPng();
   if (!fs.existsSync(png)) { t.skip('test input generation failed'); return; }

   const { code, stderr } = await runScript(['/nonexistent.mp3', '/tmp/out.mp4', png]);
   assert.notStrictEqual(code, 0);
   assert.ok(stderr.includes('не найден') || stderr.includes('Аудио'));
 });

 test('--photos: multiple photos, equal segment distribution', async (t) => {
   let hasFfmpeg = false;
   try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); hasFfmpeg = true; } catch {}
   if (!hasFfmpeg) { t.skip('ffmpeg unavailable on this host'); return; }

   const mp3 = createTestMp3(4);
   const p1  = createTestPng();
   const p2  = createTestPng();
   const out = path.join(TEST_DIR, 'out2.mp4');

   if (!fs.existsSync(mp3) || !fs.existsSync(p1) || !fs.existsSync(p2)) {
     t.skip('test input generation failed'); return;
   }

   const { code, stderr } = await runScript([mp3, out, '--photos', p1, p2]);

   assert.strictEqual(code, 0, `ffmpeg error: ${stderr}`);
   assert.ok(fs.existsSync(out));
   const dur = getDuration(out);
   assert.ok(dur >= 3.5, `Duration ~4s expected, got ${dur}`);
 });
