const test = require('node:test');
const assert = require('node:assert/strict');
const { groupWordsIntoCaptions, makeAss, validateTranslatedCaptions, wrapTwoLines } = require('../subtitle_helpers.js');

const source = (count = 2) =>
  Array.from({ length: count }, (_, i) => ({ id: i + 1, start: i * 2, end: i * 2 + 1, source_ru: `Привет ${i + 1}` }));

const ok = (t, source, translated) => {
  const errors = validateTranslatedCaptions(source, translated);
  t.assert.equal(errors.length, 0, `ожидались 0 ошибок, получили: ${JSON.stringify(errors)}`);
};

const fail = (t, source, translated, expectedCount) => {
  const errors = validateTranslatedCaptions(source, translated);
  t.assert.equal(errors.length, expectedCount, `ожидались ${expectedCount} ошибки, получили: ${JSON.stringify(errors)}`);
};
test('разбивает по паузе и сохраняет границы фразы', () => {
  const captions = groupWordsIntoCaptions([{ word: 'Привет,', start: 0, end: 0.3 }, { word: 'друзья!', start: 0.31, end: 0.8 }, { word: 'Сегодня', start: 1.5, end: 1.8 }, { word: 'поговорим.', start: 1.81, end: 2.3 }]);
  assert.deepEqual(captions, [{ id: 1, start: 0, end: 0.8, source_ru: 'Привет, друзья!' }, { id: 2, start: 1.5, end: 2.3, source_ru: 'Сегодня поговорим.' }]);
});
test('ограничивает длинную фразу без пунктуации', () => {
  const words = 'один два три четыре пять шесть семь восемь девять десять'.split(' ').map((word, i) => ({ word, start: i * 0.2, end: i * 0.2 + 0.15 }));
  const captions = groupWordsIntoCaptions(words, { maxChars: 18 });
  assert.ok(captions.length > 1); assert.ok(captions.every((caption) => caption.source_ru.length <= 18));
});
test('отклоняет изменённый таймкод и пустой перевод', () => {
  const source = [{ id: 1, start: 0, end: 1, source_ru: 'Привет' }];
  assert.equal(validateTranslatedCaptions(source, [{ id: 1, start: 0, end: 1, translated_en: 'Hello' }]).length, 0);
  assert.equal(validateTranslatedCaptions(source, [{ id: 1, start: 0.1, end: 1, translated_en: '' }]).length, 2);
});
test('создаёт ASS и экранирует управляющие символы', () => {
  const ass = makeAss([{ start: 0, end: 1.5, translated_en: 'Hello {world}\\test\nnext' }]);
  assert.match(ass, /Dialogue: 0,0:00:00.00,0:00:01.50/); assert.match(ass, /Hello world\\\\test\\Nnext/);
});
test('переносит английский текст максимум на две сбалансированные строки', () => {
  assert.equal(wrapTwoLines('This subtitle should be split into two balanced lines for mobile viewing'), 'This subtitle should be split into\ntwo balanced lines for mobile viewing');
});

// validateTranslatedCaptions
test('валидация: корректные данные — 0 ошибок', (t) => {
  const src = source(2);
  ok(t, src, [{ id: 1, start: 0, end: 1, translated_en: 'Hello' }, { id: 2, start: 2, end: 3, translated_en: 'World' }]);
});

test('валидация: не совпадает количество', (t) => {
  fail(t, source(3), [{ id: 1, start: 0, end: 1, translated_en: 'Hi' }], 1);
  fail(t, source(1), [{ id: 1, start: 0, end: 1, translated_en: 'Hi' }, { id: 2, start: 2, end: 3, translated_en: 'There' }], 1);
});

test('валидация: неверный id', (t) => {
  fail(t, source(2), [{ id: 2, start: 0, end: 1, translated_en: 'Hello' }, { id: 1, start: 2, end: 3, translated_en: 'World' }], 2);
});

test('валидация: изменённые таймкоды', (t) => {
  fail(t, source(1), [{ id: 1, start: 0.5, end: 1, translated_en: 'Hello' }], 1);
  fail(t, source(1), [{ id: 1, start: 0, end: 0.5, translated_en: 'Hello' }], 1);
});

test('валидация: пустой перевод', (t) => {
  fail(t, source(1), [{ id: 1, start: 0, end: 1, translated_en: '' }], 1);
  fail(t, source(1), [{ id: 1, start: 0, end: 1, translated_en: '   ' }], 1);
});

test('валидация: перевод длиннее 84 символов', (t) => {
  // 85 символов — две ошибки (длина + не помещается в 2 строки по 42)
  fail(t, source(1), [{ id: 1, start: 0, end: 1, translated_en: 'A'.repeat(85) }], 2);
  // 84 символа без пробелов — одна ошибка (не помещается в 2 строки, wrapTwoLines не может поделить без пробелов)
  assert.equal(validateTranslatedCaptions(source(1), [{ id: 1, start: 0, end: 1, translated_en: 'A'.repeat(84) }]).length, 1);
});

test('валидация: не помещается в две строки по 42 символа', (t) => {
  // ровно 42+42 через пробел (42+1+41 = 84) — ок
  assert.equal(validateTranslatedCaptions(source(1), [{ id: 1, start: 0, end: 1, translated_en: 'A'.repeat(42) + ' ' + 'B'.repeat(41) }]).length, 0);
  // больше 42 на строке без пробелов — ошибка
  fail(t, source(1), [{ id: 1, start: 0, end: 1, translated_en: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'.repeat(2) }], 1);
});

test('валидация: пересекающиеся таймкоды', (t) => {
  // пересечение: 0-2 и 1-3 — ошибка только на 2-м субтитре (start=1 < previousEnd=2)
  fail(t, [{ id: 1, start: 0, end: 2, source_ru: 'Раз' }, { id: 2, start: 1, end: 3, source_ru: 'Два' }],
    [{ id: 1, start: 0, end: 2, translated_en: 'One' }, { id: 2, start: 1, end: 3, translated_en: 'Two' }], 1);
  // end == next start — не ошибка
  assert.equal(validateTranslatedCaptions(
    [{ id: 1, start: 0, end: 1, source_ru: 'Раз' }, { id: 2, start: 1, end: 2, source_ru: 'Два' }],
    [{ id: 1, start: 0, end: 1, translated_en: 'One' }, { id: 2, start: 1, end: 2, translated_en: 'Two' }]
  ).length, 0);
});

test('валидация: Markdown-обёртки и JSON', (t) => {
  fail(t, source(1), [{ id: 1, start: 0, end: 1, translated_en: '```json\n{}```' }], 1);
  fail(t, source(1), [{ id: 1, start: 0, end: 1, translated_en: '```code```' }], 1);
  fail(t, source(1), [{ id: 1, start: 0, end: 1, translated_en: '[{"key":"value"}]' }], 1);
  assert.equal(validateTranslatedCaptions(source(1), [{ id: 1, start: 0, end: 1, translated_en: 'Просто текст `code` внутри' }]).length, 0);
});
