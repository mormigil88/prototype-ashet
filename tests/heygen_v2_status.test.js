// tests/heygen_v2_status.test.js
// HeyGen v2: avatar without status field → treated as active
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TEST_DIR = path.join(os.tmpdir(), `heygen-v2-test-${process.pid}`);
const REG_FILE = path.join(TEST_DIR, 'avatar_registry.json');

let savedEnv = {};

function setupEnv(overrides = {}) {
  savedEnv = {
    HEYGEN_API_KEY: process.env.HEYGEN_API_KEY,
    HEYGEN_REGISTRY_DIR: process.env.HEYGEN_REGISTRY_DIR,
    ...overrides,
  };
  Object.assign(process.env, savedEnv);
}

function restoreEnv() {
  Object.keys(savedEnv).forEach(k => {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  });
}

function cleanDir() {
  fs.rmSync(TEST_DIR, { force: true, recursive: true });
}

function makeMockFetch(v2Response) {
  return function(url, opts) {
    if (url.includes('/v2/avatars')) {
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve(v2Response),
      });
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  };
}

test.beforeEach(() => {
  cleanDir();
  fs.mkdirSync(TEST_DIR, { recursive: true });
});

test.afterEach(() => {
  cleanDir();
  restoreEnv();
});

// ─── normalizeStatus unit tests ───────────────────────────────────────────────

test('normalizeStatus: undefined/null/empty string → active', () => {
  delete require.cache[require.resolve('../heygen_avatar_registry')];
  const mod = require('../heygen_avatar_registry');
  assert.strictEqual(typeof mod.normalizeStatus, 'function');
  assert.strictEqual(mod.normalizeStatus(undefined), 'active');
  assert.strictEqual(mod.normalizeStatus(null), 'active');
  assert.strictEqual(mod.normalizeStatus(''), 'active');
});

test('normalizeStatus: known values → correct mapping', () => {
  delete require.cache[require.resolve('../heygen_avatar_registry')];
  const mod = require('../heygen_avatar_registry');
  assert.strictEqual(mod.normalizeStatus('available'), 'active');   // v2 ready
  assert.strictEqual(mod.normalizeStatus('active'), 'active');        // v1
  assert.strictEqual(mod.normalizeStatus('training'), 'training');
  assert.strictEqual(mod.normalizeStatus('unavailable'), 'inactive');
  assert.strictEqual(mod.normalizeStatus('error'), 'inactive');
  assert.strictEqual(mod.normalizeStatus('unknown_value'), 'inactive');
});

// ─── Integration: v2 without status field ────────────────────────────────────

test('v2 response without status field → avatar treated as active', async () => {
  // HeyGen v2 returns avatar WITHOUT status field
  const v2Response = {
    data: {
      avatars: [{
        avatar_id: 'irina_avatar_123',
        avatar_name: 'Ирина',
        default_voice_id: 'voice_456',
        // intentionally no status field
      }]
    }
  };

  setupEnv({ HEYGEN_API_KEY: 'test_key', HEYGEN_REGISTRY_DIR: TEST_DIR });
  global.fetch = makeMockFetch(v2Response);

  delete require.cache[require.resolve('../heygen_avatar_registry')];
  const mod = require('../heygen_avatar_registry');

  const result = await mod.selectAvatar({ doPreflight: true, preferAlias: 'основной' });
  assert.strictEqual(result.avatar_id, 'irina_avatar_123');
});

test('v2 with available status → avatar is active', async () => {
  const v2Response = {
    data: {
      avatars: [{
        avatar_id: 'irina_avatar_123',
        avatar_name: 'Ирина',
        status: 'available',
        type: 'digital_twin',
      }]
    }
  };

  setupEnv({ HEYGEN_API_KEY: 'test_key', HEYGEN_REGISTRY_DIR: TEST_DIR });
  global.fetch = makeMockFetch(v2Response);

  delete require.cache[require.resolve('../heygen_avatar_registry')];
  const mod = require('../heygen_avatar_registry');

  const result = await mod.selectAvatar({ doPreflight: true, preferAlias: 'основной' });
  assert.strictEqual(result.avatar_id, 'irina_avatar_123');
  assert.strictEqual(result.fresh, true);
});

test('v2 with training status → added to registry with training status', async () => {
  const v2Response = {
    data: {
      avatars: [{
        avatar_id: 'irina_training',
        avatar_name: 'Ирина Тренируется',
        status: 'training',
        type: 'digital_twin',
      }]
    }
  };

  setupEnv({ HEYGEN_API_KEY: 'test_key', HEYGEN_REGISTRY_DIR: TEST_DIR });
  global.fetch = makeMockFetch(v2Response);

  delete require.cache[require.resolve('../heygen_avatar_registry')];
  const mod = require('../heygen_avatar_registry');

  // Registry empty, training avatar → goes to _pending → auto-promoted to registry.avatars
  // (pending with 1 item gets promoted even if inactive/training)
  const result = await mod.selectAvatar({ doPreflight: true, preferAlias: 'основной' });
  assert.strictEqual(result.avatar_id, 'irina_training');
  assert.strictEqual(result.fresh, true);

  // Verify registry status is 'training'
  const reg = JSON.parse(fs.readFileSync(REG_FILE, 'utf8'));
  const entry = reg.avatars.find(a => a.avatar_id === 'irina_training');
  assert.ok(entry, 'training avatar added to registry');
  assert.strictEqual(entry.status, 'training');
  assert.strictEqual(entry.alias, 'основной');
});
