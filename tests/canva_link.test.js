// Тесты canva_link.js — in-process: ядро registerCanvaDesign импортируется
// напрямую, fetch стабится. Никаких сетей и дочерних процессов — быстро и
// детерминированно. CLI-обёртка (stdout/exit-коды) — тонкая и не тестируется.
// Запуск: node --test tests/canva_link.test.js
//
// Покрывают требования ТЗ:
//   1. корректная ссылка → сохранено, ответ для Иры
//   2. ссылка с query-параметрами → ID извлечён
//   3. некорректный URL → ошибка, ничего не сохранено
//   4. дубликат → запись одна, last_confirmed_at обновлён
//   5. API 403 / 404 → ошибка, ничего не сохранено
//   доп: 401 и протухший токен → отказ без сохранения

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { extractDesignId, registerCanvaDesign, CanvaFail } = require('../canva_link.js');

const REAL_FETCH = global.fetch;

// ---------- хелперы ----------

function fakeFetch({ status = 200, body = {}, calls = [] } = {}) {
  return async (url) => {
    calls.push(String(url));
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    };
  };
}

// У каждого теста свой tmp-каталог: реестр и токены не пересекаются.
function setupEnv(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canva-link-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const registryPath = path.join(dir, 'canva_designs.json');
  const tokensPath = path.join(dir, 'canva_tokens.json');
  fs.writeFileSync(tokensPath, JSON.stringify({
    access_token: 'test-access-token',
    expires_at: Date.now() + 3600_000,
  }));

  process.env.CANVA_API_BASE = 'http://fake.canva.test/rest/v1';
  process.env.CANVA_TOKENS_FILE = tokensPath;
  process.env.CANVA_DESIGNS_FILE = registryPath;

  return {
    registryPath,
    tokensPath,
    readRegistry: () => (fs.existsSync(registryPath)
      ? JSON.parse(fs.readFileSync(registryPath, 'utf8'))
      : null),
  };
}

function designBody(id, title = 'Осенний градиент') {
  return {
    design: {
      id,
      title,
      urls: {
        edit_url: `https://www.canva.com/design/${id}/edit`,
        view_url: `https://www.canva.com/design/${id}/view`,
      },
    },
  };
}

async function expectFail(code, promise) {
  await assert.rejects(promise, (e) => {
    assert.ok(e instanceof CanvaFail, `ожидали CanvaFail, получили: ${e}`);
    assert.strictEqual(e.code, code);
    return true;
  });
}

// ---------- 1. корректная ссылка ----------

test('корректная ссылка: сохраняет макет и даёт ответ для Иры', async (t) => {
  const { readRegistry } = setupEnv(t);
  const calls = [];
  global.fetch = fakeFetch({ status: 200, body: designBody('DAFabc123', 'Осенний градиент'), calls });

  const res = await registerCanvaDesign({
    url: 'Смотри, что собрала: https://www.canva.com/design/DAFabc123/edit',
    source: 'telegram',
    user: 418524161,
    chat: 418524161,
  });

  assert.strictEqual(res.created, true);
  assert.strictEqual(res.title, 'Осенний градиент');
  // Текст для Иры собирается так же, как в CLI-обёртке:
  assert.strictEqual(`Макет Canva сохранён: ${res.title}. ID: ${res.design.id}`,
    'Макет Canva сохранён: Осенний градиент. ID: DAFabc123');
  assert.match(calls[0], /\/rest\/v1\/designs\/DAFabc123$/, 'должен прийти GET /v1/designs/{id}');

  const rows = readRegistry();
  assert.strictEqual(rows.length, 1);
  const row = rows[0];
  assert.deepStrictEqual(row, {
    design_id: 'DAFabc123',
    edit_url: 'https://www.canva.com/design/DAFabc123/edit',
    title: 'Осенний градиент',
    source: 'telegram',
    telegram_user_id: 418524161,
    telegram_chat_id: 418524161,
    registered_at: row.registered_at,
    last_confirmed_at: row.last_confirmed_at,
    status: 'registered',
  });
  assert.match(row.registered_at, /^\d{4}-\d{2}-\d{2}T/);
});

// ---------- 2. ссылка с query-параметрами ----------

test('ссылка с query-параметрами и текстом вокруг: ID извлечён без хвостов', async (t) => {
  const { readRegistry } = setupEnv(t);
  const calls = [];
  global.fetch = fakeFetch({ status: 200, body: designBody('DAFq9z77'), calls });

  const res = await registerCanvaDesign({
    url: 'Глянь https://www.canva.com/design/DAFq9z77/view?feature=share&utm_source=telegram это черновик',
    source: 'telegram',
    user: 418524161,
    chat: 418524161,
  });

  assert.strictEqual(res.design.id, 'DAFq9z77');
  assert.match(calls[0], /\/designs\/DAFq9z77$/, 'в ID не должен попасть хвост /view или query');

  const rows = readRegistry();
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].design_id, 'DAFq9z77');
});

test('ссылка без www и без завершающего слэша тоже распознаётся', () => {
  assert.strictEqual(extractDesignId('https://canva.com/design/DAFbare99'), 'DAFbare99');
  assert.strictEqual(extractDesignId('http://www.canva.com/design/DAFslash1/'), 'DAFslash1');
  assert.strictEqual(extractDesignId('текст без ссылки вообще'), null);
  assert.strictEqual(extractDesignId(''), null);
});

// ---------- 3. некорректный URL ----------

test('некорректный URL: CANVA_NO_URL, API не вызывается, ничего не сохранено', async (t) => {
  const { readRegistry } = setupEnv(t);
  const calls = [];
  global.fetch = fakeFetch({ status: 200, body: designBody('SHOULD_NOT_BE_CALLED'), calls });

  await expectFail('CANVA_NO_URL', registerCanvaDesign({
    url: 'привет, посмотри https://example.com/something интересное',
    source: 'telegram',
    user: 1,
    chat: 2,
  }));

  assert.strictEqual(calls.length, 0, 'до Canva дело доходить не должно');
  assert.strictEqual(readRegistry(), null, 'файл реестра не должен появиться');
});

// ---------- 4. дубликат ----------

test('повторная ссылка: запись одна, last_confirmed_at обновлён, registered_at нет', async (t) => {
  const { registryPath, readRegistry } = setupEnv(t);

  // Предсоздаём реестр со «старой» записью — как будто макет регистрировали давно.
  fs.writeFileSync(registryPath, JSON.stringify([{
    design_id: 'DAFdup001',
    edit_url: 'https://www.canva.com/design/DAFdup001/edit',
    title: 'Старое имя',
    source: 'telegram',
    telegram_user_id: 418524161,
    telegram_chat_id: 418524161,
    registered_at: '2026-01-01T00:00:00.000Z',
    last_confirmed_at: '2026-01-01T00:00:00.000Z',
    status: 'registered',
  }]));

  global.fetch = fakeFetch({ status: 200, body: designBody('DAFdup001') });
  const res = await registerCanvaDesign({
    url: 'https://www.canva.com/design/DAFdup001/edit — этот макет актуален',
    source: 'telegram',
    user: 418524161,
    chat: 418524161,
  });

  assert.strictEqual(res.created, false, 'повтор должен распознаться как дубль');

  const rows = readRegistry();
  assert.strictEqual(rows.length, 1, 'дубль не должен создать вторую запись');
  assert.strictEqual(rows[0].design_id, 'DAFdup001');
  assert.strictEqual(rows[0].title, 'Осенний градиент', 'свежий title из Canva перезаписывает старый');
  assert.strictEqual(rows[0].registered_at, '2026-01-01T00:00:00.000Z', 'дата добавления не меняется');
  assert.ok(rows[0].last_confirmed_at > '2026-09-01', 'last_confirmed_at должен обновиться на текущий');
});

// ---------- 5. API 403 / 404 ----------

test('403 от Canva: CANVA_ACCESS_DENIED, ничего не сохранено', async (t) => {
  const { readRegistry } = setupEnv(t);
  global.fetch = fakeFetch({ status: 403, body: { error: { code: 'accessDenied' } } });

  await expectFail('CANVA_ACCESS_DENIED', registerCanvaDesign({
    url: 'https://www.canva.com/design/DAFdenied01/edit',
    source: 'telegram',
    user: 1,
    chat: 2,
  }));
  assert.strictEqual(readRegistry(), null, 'при 403 ничего не сохраняем');
});

test('404 от Canva: CANVA_NOT_FOUND, ничего не сохранено', async (t) => {
  const { readRegistry } = setupEnv(t);
  global.fetch = fakeFetch({ status: 404, body: { error: { code: 'notFound' } } });

  await expectFail('CANVA_NOT_FOUND', registerCanvaDesign({
    url: 'https://www.canva.com/design/DAFgone0000/edit',
    source: 'telegram',
    user: 1,
    chat: 2,
  }));
  assert.strictEqual(readRegistry(), null, 'при 404 ничего не сохраняем');
});

// ---------- доп: токены и 401 ----------

test('протухший токен: CANVA_AUTH_DEAD, к API не ходим, ничего не сохранено', async (t) => {
  const { tokensPath, readRegistry } = setupEnv(t);
  fs.writeFileSync(tokensPath, JSON.stringify({ access_token: 'x', expires_at: Date.now() - 1000 }));
  const calls = [];
  global.fetch = fakeFetch({ status: 200, body: designBody('DAFnope000'), calls });

  await expectFail('CANVA_AUTH_DEAD', registerCanvaDesign({
    url: 'https://www.canva.com/design/DAFnope000/edit',
    source: 'telegram',
    user: 1,
    chat: 2,
  }));
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(readRegistry(), null);
});

test('401 от Canva: CANVA_AUTH_DEAD, ничего не сохранено', async (t) => {
  const { readRegistry } = setupEnv(t);
  global.fetch = fakeFetch({ status: 401, body: { error: { code: 'unauthorized' } } });

  await expectFail('CANVA_AUTH_DEAD', registerCanvaDesign({
    url: 'https://www.canva.com/design/DAFunauth01/edit',
    source: 'telegram',
    user: 1,
    chat: 2,
  }));
  assert.strictEqual(readRegistry(), null, 'при 401 ничего не сохраняем');
});

test.after(() => {
  global.fetch = REAL_FETCH;
});
