const test = require('node:test');
const assert = require('node:assert/strict');
const { translateCaptions, DEFAULT_MODEL, ENDPOINT } = require('../openrouter_translate.js');

const source = (count = 2) =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    start: i * 2,
    end: i * 2 + 1,
    source_ru: `Привет ${i + 1}`,
  }));

function fakeFetch(overrides = {}) {
  return async (_url, options) => {
    const body = JSON.parse(options.body);
    // Verify request shape
    if (body.model !== undefined) {
      assert.equal(body.model, DEFAULT_MODEL, 'модель по умолчанию');
    }
    assert.equal(body.messages[0].role, 'user');
    assert.ok(body.messages[0].content.includes('Привет 1'));
    assert.equal(options.headers['Authorization'], 'Bearer test-key');
    assert.equal(options.headers['Content-Type'], 'application/json');

    const { status = 200, body: responseBody } = overrides;
    return {
      ok: status >= 200 && status < 300,
      status,
      async text() { return responseBody; },
    };
  };
}

test('успешный JSON', async () => {
  const caps = source(2);
  const result = await translateCaptions(caps, {
    apiKey: 'test-key',
    fetchImpl: fakeFetch({
      body: JSON.stringify({
        choices: [{ message: { content: '{"captions":[{"id":1,"start":0,"end":1,"translated_en":"Hello"},{"id":2,"start":2,"end":3,"translated_en":"World"}]}' } }]
      }),
    }),
  });
  assert.equal(result.length, 2);
  assert.equal(result[0].translated_en, 'Hello');
  assert.equal(result[0].id, 1);
  assert.equal(result[0].start, 0);
  assert.equal(result[0].end, 1);
});

test('JSON в Markdown-кодблоке', async () => {
  const caps = source(1);
  const result = await translateCaptions(caps, {
    apiKey: 'test-key',
    fetchImpl: fakeFetch({
      body: JSON.stringify({
        choices: [{ message: { content: '```json\n{"captions":[{"id":1,"start":0,"end":1,"translated_en":"Hi"}]}\n```' } }]
      }),
    }),
  });
  assert.equal(result[0].translated_en, 'Hi');
});

test('HTTP 429 — ошибка', async () => {
  await assert.rejects(
    () => translateCaptions(source(1), {
      apiKey: 'test-key',
      fetchImpl: fakeFetch({ status: 429, body: '{}' }),
    }),
    /HTTP 429/,
  );
});

test('ответ без choices — ошибка', async () => {
  await assert.rejects(
    () => translateCaptions(source(1), {
      apiKey: 'test-key',
      fetchImpl: fakeFetch({ body: JSON.stringify({ choices: [] }) }),
    }),
    /нет choices/,
  );
});

test('перевод с изменённым таймкодом — ошибка валидации', async () => {
  await assert.rejects(
    () => translateCaptions(source(2), {
      apiKey: 'test-key',
      fetchImpl: fakeFetch({
        body: JSON.stringify({
          choices: [{ message: { content: '{"captions":[{"id":1,"start":99,"end":100,"translated_en":"Hello"},{"id":2,"start":2,"end":3,"translated_en":"World"}]}' } }]
        }),
      }),
    }),
    /Ошибки валидации/,
  );
});

test('пустой apiKey — ошибка', async () => {
  await assert.rejects(
    () => translateCaptions(source(1), { apiKey: '', fetchImpl: fakeFetch({}) }),
    /OPENROUTER_API_KEY не задан/,
  );
  await assert.rejects(
    () => translateCaptions(source(1), { apiKey: undefined, fetchImpl: fakeFetch({}) }),
    /OPENROUTER_API_KEY не задан/,
  );
});

test('choices: [{}] — ошибка', async () => {
  await assert.rejects(
    () => translateCaptions(source(1), {
      apiKey: 'test-key',
      fetchImpl: fakeFetch({
        body: JSON.stringify({ choices: [{}] }),
      }),
    }),
    /нет текстового content/,
  );
});

test('переданная model вместо DEFAULT_MODEL', async () => {
  let capturedModel;
  const captor = async (_url, options) => {
    capturedModel = JSON.parse(options.body).model;
    return {
      ok: true, status: 200,
      async text() { return JSON.stringify({ choices: [{ message: { content: '{"captions":[{"id":1,"start":0,"end":1,"translated_en":"Hi"}]}' } }] }); },
    };
  };
  await translateCaptions(source(1), { apiKey: 'test-key', model: 'some/model:free', fetchImpl: captor });
  assert.equal(capturedModel, 'some/model:free');
});

test('проверяет URL, Authorization и модель по умолчанию', async () => {
  let capturedUrl, capturedHeaders, capturedModel;
  const captor = async (url, options) => {
    capturedUrl = url;
    capturedHeaders = options.headers;
    capturedModel = JSON.parse(options.body).model;
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          choices: [{ message: { content: '{"captions":[{"id":1,"start":0,"end":1,"translated_en":"Hi"}]}' } }]
        });
      },
    };
  };
  await translateCaptions(source(1), { apiKey: 'my-secret-key', fetchImpl: captor });
  assert.equal(capturedUrl, ENDPOINT);
  assert.equal(capturedHeaders['Authorization'], 'Bearer my-secret-key');
  assert.equal(capturedModel, DEFAULT_MODEL);
});
