const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArgs, extractAudioToMp3, finishMedia } = require('../generate_avatar_video');
const { buildObjectKey } = require('../media_archive');

test('voice-only and avatar alias are parsed together', () => {
  const args = parseArgs(['node', 'generate_avatar_video.js', '--voice-only', '--avatar', 'основной', 'Стих']);
  assert.equal(args.voiceOnly, true);
  assert.equal(args.avatarAlias, 'основной');
  assert.equal(args.script, 'Стих');
});

test('voice-only returns MP3 after archiving distinct video and audio objects', async () => {
  const events = [];
  const args = { voiceOnly: true, script: 'Стих', ratio: '9:16' };
  const result = await finishMedia('/tmp/sample.mp4', args, 'video-1', async (file, meta) => {
    events.push({ file, key: buildObjectKey(file, meta) });
    return { ok: true, status: 'done' };
  }, file => {
    events.push({ extractedFrom: file });
    return '/tmp/sample.mp3';
  });
  assert.equal(result, '/tmp/sample.mp3');
  assert.deepEqual(events.map(x => x.extractedFrom || x.file), [
    '/tmp/sample.mp4', '/tmp/sample.mp4', '/tmp/sample.mp3',
  ]);
  assert.match(events[1].key, /video-1\.mp4$/);
  assert.match(events[2].key, /video-1\.mp3$/);
});

test('voice-only still returns MP3 when R2 archive fails', async () => {
  const result = await finishMedia('/tmp/sample.mp4', {
    voiceOnly: true, script: 'Стих', ratio: '9:16',
  }, 'video-2', async () => ({ ok: false, status: 'failed', reason: 'R2 unavailable' }),
  () => '/tmp/sample.mp3');
  assert.equal(result, '/tmp/sample.mp3');
});

test('ordinary video mode returns MP4 and never extracts audio', async () => {
  const result = await finishMedia('/tmp/sample.mp4', {
    voiceOnly: false, script: 'Стих', ratio: '9:16',
  }, 'video-3', async () => ({ ok: true, status: 'done' }),
  () => { throw new Error('audio extraction must not run'); });
  assert.equal(result, '/tmp/sample.mp4');
});

test('ffmpeg receives audio-only MP3 arguments and returns the output path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heygen-audio-test-'));
  const mp4 = path.join(dir, 'input.mp4');
  try {
    const mp3 = extractAudioToMp3(mp4, (command, args) => {
      assert.equal(command, 'ffmpeg');
      assert.deepEqual(args.slice(0, 4), ['-y', '-i', mp4, '-vn']);
      assert.ok(args.includes('192k'));
      fs.writeFileSync(args.at(-1), 'fake mp3');
    });
    assert.equal(mp3, path.join(dir, 'input.mp3'));
    assert.ok(fs.statSync(mp3).size > 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
