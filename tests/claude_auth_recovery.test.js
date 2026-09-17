const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ClaudeAuthRecovery } = require('../claude_auth_recovery');

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    writable: true,
    writes: [],
    write(value) { this.writes.push(value); },
  };
  return child;
}

test('создаёт кнопку только для нужного чата и не сохраняет OAuth-ссылку', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-auth-test-'));
  const stateFile = path.join(dir, 'state.json');
  const child = fakeChild();
  const links = [];
  let now = 1000;
  const recovery = new ClaudeAuthRecovery({
    chatId: '418524161',
    stateFile,
    spawnFn: () => child,
    now: () => now,
    sendLoginLink: async (url) => { links.push(url); },
    sendStatus: async () => {},
    logger: { error() {} },
  });

  assert.equal(recovery.start(), true);
  assert.equal(recovery.start(), false);
  const url = 'https://claude.com/cai/oauth/authorize?code=true&state=one-time-secret';
  child.stdout.emit('data', Buffer.from(url.slice(0, 42)));
  child.stdout.emit('data', Buffer.from(`${url.slice(42)}\n`));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(links, [url]);
  assert.doesNotMatch(fs.readFileSync(stateFile, 'utf8'), /one-time-secret/);
  assert.equal(recovery.submitCode('999', '/kimi-login correct-code', 1001), false);
  assert.equal(recovery.submitCode('418524161', '/kimi-login old-code', 999), false);
  assert.equal(recovery.submitCode('418524161', '/kimi-login correct-code', 1001), true);
  assert.equal(recovery.submitCode('418524161', '/kimi-login repeated-code', 1002), false);
  assert.deepEqual(child.stdin.writes, ['correct-code\n']);
});

test('ошибка старта не раскрывает ссылку и освобождает recovery для следующей попытки', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-auth-test-'));
  const child = fakeChild();
  const statuses = [];
  const recovery = new ClaudeAuthRecovery({
    chatId: '418524161',
    stateFile: path.join(dir, 'state.json'),
    cooldownMs: 0,
    spawnFn: () => child,
    sendLoginLink: async () => {},
    sendStatus: async (text) => { statuses.push(text); },
    logger: { error() {} },
  });
  recovery.start();
  child.emit('error', new Error('pty unavailable'));
  assert.equal(recovery.child, null);
  assert.doesNotMatch(statuses.join('\n'), /https:\/\//);
});
