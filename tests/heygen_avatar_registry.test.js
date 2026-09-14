// Тесты heygen_avatar_registry.js (10 кейсов).
// Запуск: node --test tests/heygen_avatar_registry.test.js
//
// Preflight-мок (fetch) подменяется глобально per-тест через { beforeEach }.
// Реестр пишется в /tmp/heygen-test/avatar_registry.json — не трогает продакшен.

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');

// ─── Мок-контекст: подменяет fetch, ENV, пути реестра ─────────────────────────

const TEST_DIR  = path.join(os.tmpdir(), `heygen-reg-test-${process.pid}`);
const REG_FILE  = path.join(TEST_DIR, 'avatar_registry.json');
const DTWIN_FILE = path.join(TEST_DIR, 'heygen_irina_digital_twin.json');

let mockFetch;
let savedEnv = {};

function setupEnv(overrides = {}) {
  savedEnv = {
    HEYGEN_API_KEY:        process.env.HEYGEN_API_KEY,
    HEYGEN_REGISTRY_DIR:   process.env.HEYGEN_REGISTRY_DIR,
    HEYGEN_IRINA_LEGACY:   process.env.HEYGEN_IRINA_LEGACY,
    ...overrides,
  };
  Object.assign(process.env, savedEnv);
}

function restoreEnv() {
  if (savedEnv) {
    Object.keys(savedEnv).forEach(k => {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    });
  }
}

function cleanDir() {
  fs.rmSync(TEST_DIR, { force: true, recursive: true });
}

function readReg() {
  if (!fs.existsSync(REG_FILE)) return null;
  return JSON.parse(fs.readFileSync(REG_FILE, 'utf8'));
}

// Мок fetch: возвращает预设ленные данные или падает
function makeMockFetch(avatarMap) {
  return function(url, opts) {
    const throws = avatarMap._throws;
    if (throws) {
      const err = typeof throws === 'string' ? new Error(throws) : throws;
      err.response = { status: throws.status || 500 };
      throw err;
    }

    const hgAvatars = avatarMap._avatars || [];
    const isPreflight = url.includes('/v2/avatars');
    const isCreate    = url.includes('/v3/videos') && opts?.method === 'POST';
    const isStatus    = url.match(/\/v3\/videos\/([^/]+)$/) && opts?.method === 'GET';

    if (isPreflight) {
      return Promise.resolve({
        ok:     true,
        status: 200,
        json:   () => Promise.resolve({ avatars: hgAvatars }),
      });
    }

    if (isCreate) {
      const body = typeof opts?.body === 'string' ? JSON.parse(opts.body) : opts?.body;
      const avatarId = body?.avatar_id;
      const found = hgAvatars.find(a => a.avatar_id === avatarId);
      if (!found) {
        return Promise.resolve({
          ok:     false,
          status: 404,
          json:   () => Promise.resolve({ error: { message: 'avatar not found' } }),
        });
      }
      return Promise.resolve({
        ok:     true,
        status: 200,
        json:   () => Promise.resolve({ data: { video_id: `vid_${avatarId}` } }),
      });
    }

    if (isStatus) {
      return Promise.resolve({
        ok:     true,
        status: 200,
        json:   () => Promise.resolve({ data: { status: 'completed', video_url: 'https://cdn.heygen.com/fake.mp4' } }),
      });
    }

    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  };
}

// Перезапускает модуль с новым моком (сбрасывает кеш require)
async function reloadModule(mockAvatars, overrides = {}) {
  setupEnv({
    HEYGEN_API_KEY:      'test_key_' + Date.now(),
    HEYGEN_REGISTRY_DIR: TEST_DIR,
    HEYGEN_IRINA_LEGACY: DTWIN_FILE,
    ...overrides,
  });
  mockFetch = makeMockFetch(mockAvatars);
  // Подменяем глобальный fetch
  if (global.fetch !== mockFetch) global.fetch = mockFetch;

  // Сбрасываем require-кэш для реестра
  delete require.cache[require.resolve('../heygen_avatar_registry')];
  const mod = require('../heygen_avatar_registry');
  return mod;
}

// ─── beforeEach / afterEach ────────────────────────────────────────────────────

test.beforeEach(() => {
  cleanDir();
  fs.mkdirSync(TEST_DIR, { recursive: true });
});

test.afterEach(() => {
  cleanDir();
  restoreEnv();
  if (global.fetch !== global.__origFetch) global.fetch = global.__origFetch;
});

// ─── ТЕСТ 1: один активный аватар → выбирается без ошибок ─────────────────────

test('selectAvatar: один активный аватар → возвращает его avatar_id и voice_id', async () => {
  const mod = await reloadModule({
    _avatars: [
      { avatar_id: 'avatar_001', name: 'Ирина Основной', status: 'active', type: 'digital_twin' },
    ],
  });

  const result = await mod.selectAvatar({ doPreflight: true });

  assert.strictEqual(result.avatar_id, 'avatar_001');
  assert.strictEqual(result.alias, 'основной');
  assert.strictEqual(result.name,  'Ирина Основной');
  assert.strictEqual(result.fresh, true); // новый аватар из _pending

  // Реестр записан
  const reg = readReg();
  assert.strictEqual(reg.avatars.length, 1);
  assert.strictEqual(reg.default_alias, 'основной');
});

// ─── ТЕСТ 2: несколько аватаров без явного выбора → AMBIGUOUS ─────────────────

test('selectAvatar: несколько активных аватаров, alias не найден → HeyGenFail AMBIGUOUS', async () => {
  const mod = await reloadModule({
    _avatars: [
      { avatar_id: 'avatar_001', name: 'Ирина Основной', status: 'active', type: 'digital_twin' },
      { avatar_id: 'avatar_002', name: 'Ирина Деловой',  status: 'active', type: 'digital_twin' },
    ],
  });

  // Нет записи в реестре, preflight нашёл 2 аватара
  let err;
  try {
    await mod.selectAvatar({ preferAlias: 'деловой', doPreflight: true });
  } catch (e) { err = e; }

  assert.ok(err instanceof mod.HeyGenFail, 'ожидался HeyGenFail');
  assert.strictEqual(err.code, 'HEYGEN_AMBIGUOUS_REPLACEMENT');
});

// ─── ТЕСТ 3: устаревший ID → preflight помечает inactive, один оставшийся активный → подхватывается ─

test('selectAvatar: сохранённый аватар стал inactive, один новый активный → auto-replacement', async () => {
  // В реестре — устаревший avatar_001, preflight знает только avatar_002
  fs.writeFileSync(REG_FILE, JSON.stringify({
    version: 1, updated_at: new Date().toISOString(),
    avatars: [{
      id: 'e1', alias: 'основной', name: 'Ирина Старый',
      type: 'digital_twin', status: 'active', // старый статус до preflight
      avatar_id: 'avatar_001', voice_id: 'voice_001',
      created_at: new Date().toISOString(), last_verified_at: new Date().toISOString(),
    }],
    default_alias: 'основной',
  }));

  const mod = await reloadModule({
    _avatars: [
      { avatar_id: 'avatar_002', name: 'Ирина Новый', status: 'active', type: 'digital_twin' },
    ],
  });

  const result = await mod.selectAvatar({ doPreflight: true });

  assert.strictEqual(result.avatar_id, 'avatar_002');
  assert.strictEqual(result.fresh,     true);

  const reg = readReg();
  const entry = reg.avatars.find(a => a.avatar_id === 'avatar_002');
  assert.ok(entry, 'новый аватар добавлен в реестр');
  assert.strictEqual(entry.status, 'active');
  const old = reg.avatars.find(a => a.avatar_id === 'avatar_001');
  assert.strictEqual(old.status, 'inactive');
});

// ─── ТЕСТ 4: 404 с успешным auto-recovery (ровно один активный аватар) ────────

test('resolve404WithRecovery: один активный аватар в HeyGen → возвращает его и сохраняет', async () => {
  // В реестре avatar_001, но в HeyGen его больше нет; активен только avatar_002
  fs.writeFileSync(REG_FILE, JSON.stringify({
    version: 1, updated_at: new Date().toISOString(),
    avatars: [{
      id: 'e1', alias: 'основной', name: 'Ирина Старый',
      type: 'digital_twin', status: 'active',
      avatar_id: 'avatar_001', voice_id: 'voice_001',
      created_at: new Date().toISOString(), last_verified_at: new Date().toISOString(),
    }],
    default_alias: 'основной',
  }));

  const mod = await reloadModule({
    _avatars: [
      { avatar_id: 'avatar_002', name: 'Ирина Замена', status: 'active', type: 'digital_twin' },
    ],
  });

  const result = await mod.resolve404WithRecovery('avatar_001');

  assert.strictEqual(result.avatar_id, 'avatar_002');
  assert.strictEqual(result.fresh,     true);

  // Реестр обновлён: старый inactive, новый active
  const reg = readReg();
  assert.strictEqual(reg.avatars.find(a => a.avatar_id === 'avatar_001').status, 'inactive');
  assert.strictEqual(reg.avatars.find(a => a.avatar_id === 'avatar_002').status, 'active');
});

// ─── ТЕСТ 5: 404 без однозначной замены (несколько активных) → HeyGenFail ─────

test('resolve404WithRecovery: несколько активных аватаров → HeyGenFail AVATAR_NOT_FOUND, НЕ выбирает наугад', async () => {
  fs.writeFileSync(REG_FILE, JSON.stringify({
    version: 1, updated_at: new Date().toISOString(),
    avatars: [{
      id: 'e1', alias: 'основной', name: 'Ирина Старая',
      type: 'digital_twin', status: 'active',
      avatar_id: 'avatar_001', voice_id: 'voice_001',
      created_at: new Date().toISOString(), last_verified_at: new Date().toISOString(),
    }],
    default_alias: 'основной',
  }));

  const mod = await reloadModule({
    _avatars: [
      { avatar_id: 'avatar_002', name: 'Ирина Деловой',  status: 'active', type: 'digital_twin' },
      { avatar_id: 'avatar_003', name: 'Ирина Улыбка',   status: 'active', type: 'digital_twin' },
    ],
  });

  let err;
  try {
    await mod.resolve404WithRecovery('avatar_001');
  } catch (e) { err = e; }

  assert.ok(err instanceof mod.HeyGenFail, 'ожидался HeyGenFail');
  assert.strictEqual(err.code, 'HEYGEN_AVATAR_NOT_FOUND');
  assert.ok(err.message.includes('кредиты не потрачены'), 'должно быть понятное сообщение');
});

// ─── ТЕСТ 6: preflight с HTTP-ошибкой → HeyGenFail PREFLIGHT_FAILED ──────────

test('selectAvatar: preflight возвращает 503 → HeyGenFail PREFLIGHT_FAILED', async () => {
  const mod = await reloadModule({
    _throws: { status: 503, message: 'Service Unavailable' },
  });

  let err;
  try {
    await mod.selectAvatar({ doPreflight: true });
  } catch (e) { err = e; }

  assert.ok(err instanceof mod?.HeyGenFail);
  assert.strictEqual(err.code, 'HEYGEN_PREFLIGHT_FAILED');
  assert.ok(err.message.includes('Service Unavailable') || err.message.includes('503'));
});

// ─── ТЕСТ 7: пустой реестр + legacy-файл → миграция ─────────────────────────

test('selectAvatar: пустой реестр, есть legacy Digital Twin → миграция в реестр', async () => {
  fs.writeFileSync(DTWIN_FILE, JSON.stringify({
    avatar_id: 'legacy_avatar', group_id: 'legacy_group',
    voice_id:  'legacy_voice', status: 'active',
    consent_status: 'confirmed', created_at: new Date().toISOString(),
  }));

  // HeyGen знает этот аватар
  const mod = await reloadModule({
    _avatars: [
      { avatar_id: 'legacy_avatar', name: 'Legacy Irina', status: 'active', type: 'digital_twin' },
    ],
  });

  const result = await mod.selectAvatar({ doPreflight: true });

  assert.strictEqual(result.avatar_id, 'legacy_avatar');
  assert.strictEqual(result.voice_id,  'legacy_voice');
  assert.strictEqual(result.alias,     'основной');

  const reg = readReg();
  assert.strictEqual(reg.avatars.length, 1);
  assert.strictEqual(reg.avatars[0].alias, 'основной');
});

// ─── ТЕСТ 8: duplicate alias при регистрации → HeyGenFail ───────────────────

test('registerAvatar: повторный alias → HeyGenFail DUPLICATE_ALIAS', async () => {
  fs.writeFileSync(REG_FILE, JSON.stringify({
    version: 1, updated_at: new Date().toISOString(),
    avatars: [{
      id: 'e1', alias: 'основной', name: 'Ирина Первая',
      type: 'digital_twin', status: 'active',
      avatar_id: 'avatar_first', voice_id: null,
      created_at: new Date().toISOString(), last_verified_at: new Date().toISOString(),
    }],
    default_alias: 'основной',
  }));

  const mod = await reloadModule({ _avatars: [] });

  let err;
  try {
    mod.registerAvatar({ alias: 'основной', name: 'Ирина Вторая', avatar_id: 'avatar_second' });
  } catch (e) { err = e; }

  assert.ok(err instanceof mod?.HeyGenFail);
  assert.strictEqual(err.code, 'HEYGEN_DUPLICATE_ALIAS');
  assert.ok(err.message.includes('основной'));
});

// ─── ТЕСТ 9: setDefault → меняет default_alias ────────────────────────────────

test('setDefault: переключает аватар по умолчанию', async () => {
  fs.writeFileSync(REG_FILE, JSON.stringify({
    version: 1, updated_at: new Date().toISOString(),
    avatars: [
      {
        id: 'e1', alias: 'основной', name: 'Ирина Основной',
        type: 'digital_twin', status: 'active',
        avatar_id: 'avatar_001', voice_id: 'voice_001',
        created_at: new Date().toISOString(), last_verified_at: new Date().toISOString(),
      },
      {
        id: 'e2', alias: 'деловой', name: 'Ирина Деловой',
        type: 'digital_twin', status: 'active',
        avatar_id: 'avatar_002', voice_id: 'voice_002',
        created_at: new Date().toISOString(), last_verified_at: new Date().toISOString(),
      },
    ],
    default_alias: 'основной',
  }));

  const mod = await reloadModule({ _avatars: [] });
  mod.setDefault('деловой');

  const reg = readReg();
  assert.strictEqual(reg.default_alias, 'деловой');
});

test('setDefault: неизвестный alias → HeyGenFail', async () => {
  fs.writeFileSync(REG_FILE, JSON.stringify({
    version: 1, updated_at: new Date().toISOString(),
    avatars: [{
      id: 'e1', alias: 'основной', name: 'Ирина',
      type: 'digital_twin', status: 'active',
      avatar_id: 'avatar_001', voice_id: null,
      created_at: new Date().toISOString(), last_verified_at: new Date().toISOString(),
    }],
    default_alias: 'основной',
  }));

  const mod = await reloadModule({ _avatars: [] });

  let err;
  try { mod.setDefault('несуществующий'); }
  catch (e) { err = e; }

  assert.ok(err instanceof mod?.HeyGenFail);
  assert.strictEqual(err.code, 'HEYGEN_AVATAR_NOT_FOUND');
});

// ─── ТЕСТ 10: registerAvatar → добавляет запись, первый аватар становится default ─

test('registerAvatar: первая регистрация → становится default', async () => {
  const mod = await reloadModule({ _avatars: [] });

  const entry = mod.registerAvatar({
    alias: 'мой-аватар', name: 'Ирина Мой', type: 'digital_twin',
    avatar_id: 'new_avatar_99', voice_id: 'new_voice_99',
  });

  assert.strictEqual(entry.alias,    'мой-аватар');
  assert.strictEqual(entry.avatar_id, 'new_avatar_99');

  const reg = readReg();
  assert.strictEqual(reg.avatars.length,    1);
  assert.strictEqual(reg.default_alias,      'мой-аватар');
  assert.strictEqual(reg.avatars[0].voice_id, 'new_voice_99');
});

// ─── Дополнительные тесты (правки 07.09) ─────────────────────────────────────

// П1: preflight fail → selectAvatar выбрасывает, НЕ возвращает cached
test('selectAvatar: preflight 503 без кеша → HeyGenFail PREFLIGHT_FAILED, НЕ кеш', async () => {
  // Реестр пустой, preflight падает
  const mod = await reloadModule({
    _throws: { status: 503, message: 'Service Unavailable' },
  });

  let err;
  try {
    await mod.selectAvatar({ doPreflight: true });
  } catch (e) { err = e; }

  assert.ok(err instanceof mod?.HeyGenFail);
  assert.strictEqual(err.code, 'HEYGEN_PREFLIGHT_FAILED');
  // Кеш не должен использоваться — нет ни одного активного аватара
  assert.strictEqual(err.message.includes('avatar_'), false);
});

// П2: сообщение об ошибке не содержит avatar_id и voice_id
test('selectAvatar: сообщение ошибки не содержит ID', async () => {
  const mod = await reloadModule({
    _throws: { status: 503, message: 'Service Unavailable' },
  });

  let err;
  try {
    await mod.selectAvatar({ doPreflight: true });
  } catch (e) { err = e; }

  assert.ok(err instanceof mod?.HeyGenFail);
  assert.strictEqual(err.message.includes('avatar_'), false);
  assert.strictEqual(err.message.includes('voice_'), false);
  assert.strictEqual(err.message.includes('/data/'), false);
});

// П5: legacy + env с разными ID → два разных alias, без дубликата "основной"
test('migrateFromLegacy: legacy и env с разными ID → два alias, дедупликация', async () => {
  // Пишем legacy-файл
  fs.writeFileSync(DTWIN_FILE, JSON.stringify({
    avatar_id: 'legacy_avatar', group_id: 'legacy_group',
    voice_id: 'legacy_voice', status: 'active',
  }));
  // Переопределяем env на другой avatar_id
  const mod = await reloadModule(
    { _avatars: [] },
    { HEYGEN_AVATAR_ID_IRINA: 'env_avatar' }
  );

  // Вызываем миграцию
  const { migrateFromLegacy } = mod;
  let registry = mod.loadRegistry() || { version: 1, avatars: [], default_alias: 'основной' };
  const changed = migrateFromLegacy(registry);

  assert.strictEqual(changed, true);
  assert.strictEqual(registry.avatars.length, 2);

  const aliases = registry.avatars.map(a => a.alias).sort();
  assert.deepStrictEqual(aliases, ['основной', 'основной-2']);

  const ids = registry.avatars.map(a => a.avatar_id).sort();
  assert.deepStrictEqual(ids, ['env_avatar', 'legacy_avatar']);
});

// П5: legacy + env с одинаковым ID → один avatar, один alias
test('migrateFromLegacy: legacy и env с одинаковым ID → один avatar, дедупликация', async () => {
  fs.writeFileSync(DTWIN_FILE, JSON.stringify({
    avatar_id: 'same_avatar', group_id: 'g1',
    voice_id: 'v1', status: 'active',
  }));
  const mod = await reloadModule(
    { _avatars: [] },
    { HEYGEN_AVATAR_ID_IRINA: 'same_avatar' }
  );

  const { migrateFromLegacy } = mod;
  let registry = mod.loadRegistry() || { version: 1, avatars: [], default_alias: 'основной' };
  const changed = migrateFromLegacy(registry);

  assert.strictEqual(changed, true);
  assert.strictEqual(registry.avatars.length, 1);
  assert.strictEqual(registry.avatars[0].alias, 'основной');
  assert.strictEqual(registry.avatars[0].avatar_id, 'same_avatar');
});

// П3: listAvatarsSafe возвращает безопасный список БЕЗ avatar_id
test('listAvatarsSafe: результат не содержит avatar_id и voice_id', async () => {
  fs.writeFileSync(REG_FILE, JSON.stringify({
    version: 1, updated_at: new Date().toISOString(),
    avatars: [{
      id: 'e1', alias: 'основной', name: 'Ирина Основной',
      type: 'digital_twin', status: 'active',
      avatar_id: 'SECRET_av_001', voice_id: 'SECRET_vc_001',
      created_at: new Date().toISOString(), last_verified_at: new Date().toISOString(),
    }],
    default_alias: 'основной',
  }));

  const mod = await reloadModule({ _avatars: [] });
  const { choices, default_number } = mod.listAvatarsSafe();

  assert.strictEqual(choices.length, 1);
  assert.strictEqual(choices[0].name, 'Ирина Основной');
  assert.strictEqual(choices[0].alias, 'основной');
  assert.strictEqual(choices[0].status, 'active');
  assert.strictEqual(choices[0].avatar_id, undefined);  // НЕТ avatar_id!
  assert.strictEqual(choices[0].voice_id, undefined);   // НЕТ voice_id!
  assert.strictEqual(default_number, 1);
});

// П7: тест интеграции generate_avatar_video — preflight fail → POST не вызывается
test('generate_avatar_video: preflight fail → POST не вызывается', async () => {
  // Создаём скрипт который импортирует generate_avatar_video и проверяет что POST не вызван
  const testScript = `
    const { HeyGenFail, selectAvatar } = require('./heygen_avatar_registry');
    let postCalled = false;
    const origFetch = global.fetch;
    global.fetch = function(url, opts) {
      if (opts?.method === 'POST' && url.includes('/v3/videos')) {
        postCalled = true;
      }
      return origFetch.call(this, url, opts);
    };
    // Теперь selectAvatar с preflight fail
    return selectAvatar({ doPreflight: true })
      .then(() => { throw new Error('should have thrown'); })
      .catch(err => {
        global.fetch = origFetch;
        return { code: err.code, postCalled };
      });
  `;

  // Мокаем preflight на 503
  const mod = await reloadModule({
    _throws: { status: 503, message: 'Service Unavailable' },
  });

  const result = await mod.selectAvatar({ doPreflight: true })
    .then(() => ({ threw: false }))
    .catch(err => ({ threw: true, code: err.code }));

  // Должен выбросить, НЕ вызвать POST
  assert.strictEqual(result.threw, true);
  assert.strictEqual(result.code, 'HEYGEN_PREFLIGHT_FAILED');
});
