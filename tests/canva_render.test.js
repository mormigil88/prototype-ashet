// Тесты исправлений canva_render.js (баги №4 и №5):
//   - parseArgs — разбор CLI-аргументов (включая спец-случай --fields --template)
//   - getDatasetFields — два формата dataset от API ({dataset:{...}} и сам {...})
//   - extractCompletedDesign — все варианты расположения дизайна в completed-job
// Ядро импортируется напрямую (main() защищён require.main === module).
// Запуск: node --test tests/canva_render.test.js

const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'canva_render.js');
const { parseArgs, getDatasetFields, extractCompletedDesign } = require(SCRIPT);

// ---------- parseArgs ----------

test('parseArgs: полный render-вызов разбирается по флагам', () => {
  const args = parseArgs([
    '--render', '--template', 'EAHUOmdpCr8',
    '--fields', '{"заголовок":{"type":"text","text":"Тест"}}',
    '--out', '/tmp/kimi-canva-test.png', '--format', 'png', '--title', 'Kimi Canva — test',
  ]);
  assert.strictEqual(args.render, true);
  assert.strictEqual(args.template, 'EAHUOmdpCr8');
  assert.strictEqual(args.fields, '{"заголовок":{"type":"text","text":"Тест"}}');
  assert.strictEqual(args.out, '/tmp/kimi-canva-test.png');
  assert.strictEqual(args.format, 'png');
  assert.strictEqual(args.title, 'Kimi Canva — test');
});

test('parseArgs: --fields перед --template — булев флаг, не съедает --template', () => {
  const args = parseArgs(['--fields', '--template', 'EAHUOmdpCr8']);
  assert.strictEqual(args.fields, true, '--fields без значения → true');
  assert.strictEqual(args.template, 'EAHUOmdpCr8', '--template не должен быть проглочен как значение --fields');
});

// ---------- getDatasetFields (баг №4) ----------

test('getDatasetFields: реальный поток — getDataset() уже развернул resp.dataset', () => {
  // API подтверждённо отвечает {"dataset":{"заголовок":...,"подзаголовок":...}},
  // getDataset() возвращает внутренний объект — его и получает helper.
  const resp = { dataset: { 'заголовок': { type: 'text' }, 'подзаголовок': { type: 'text' } } };
  const inner = (resp && resp.dataset) || resp; // это и делает getDataset()
  const fields = getDatasetFields(inner);
  assert.deepStrictEqual(Object.keys(fields).sort(), ['заголовок', 'подзаголовок']);
});

test('getDatasetFields: «голый» объект полей (как реально отвечает API) → тот же словарь', () => {
  const fields = getDatasetFields({ 'заголовок': { type: 'text' }, 'подзаголовок': { type: 'text' } });
  assert.deepStrictEqual(Object.keys(fields).sort(), ['заголовок', 'подзаголовок']);
});

test('getDatasetFields: явный .fields и null-кейсы', () => {
  assert.deepStrictEqual(getDatasetFields({ fields: { a: { type: 'text' } } }), { a: { type: 'text' } });
  assert.strictEqual(getDatasetFields(null), null);
  assert.strictEqual(getDatasetFields(undefined), null);
  assert.strictEqual(getDatasetFields('string'), null);
});

// ---------- extractCompletedDesign (баг №5) ----------

test('extractCompletedDesign: design в job.design', () => {
  const d = extractCompletedDesign({ job: { status: 'completed', design: { id: 'DAFdesign1' } } });
  assert.strictEqual(d.id, 'DAFdesign1');
});

test('extractCompletedDesign: design в job.result.autofill_job.design', () => {
  const d = extractCompletedDesign({
    job: { status: 'completed', result: { autofill_job: { design: { id: 'DAFdesign2' } } } },
  });
  assert.strictEqual(d.id, 'DAFdesign2');
});

test('extractCompletedDesign: design в job.result.design (без обёртки job)', () => {
  const d = extractCompletedDesign({ status: 'completed', result: { design: { id: 'DAFdesign3' } } });
  assert.strictEqual(d.id, 'DAFdesign3');
});

test('extractCompletedDesign: прод-формат — status "success" + result.design', () => {
  // Реальный ответ API 06.09: {job:{id,status:"success",result:{type,design,trial_information}}}
  const d = extractCompletedDesign({
    job: { id: 'job1', status: 'success', result: { type: 'autofill', design: { id: 'DAHUVbQF_Tc' } } },
  });
  assert.strictEqual(d.id, 'DAHUVbQF_Tc');
  const d2 = extractCompletedDesign({ job: { status: 'success', design: { id: 'DAFviaJobDesign' } } });
  assert.strictEqual(d2.id, 'DAFviaJobDesign');
});

test('extractCompletedDesign: не completed/success → undefined (poll ждёт дальше)', () => {
  assert.strictEqual(extractCompletedDesign({ job: { status: 'running' } }), undefined);
  assert.strictEqual(extractCompletedDesign({ job: { status: 'pending' } }), undefined);
  assert.strictEqual(extractCompletedDesign({ job: { status: 'failed' } }), undefined);
  assert.strictEqual(extractCompletedDesign(null), undefined);
});

test('extractCompletedDesign: completed без дизайна → exit 1 с CANVA_JOB_FAILED, не таймаут', () => {
  const r = spawnSync(process.execPath, ['-e',
    `require(${JSON.stringify(SCRIPT)});` +
    'require(' + JSON.stringify(SCRIPT) + ').extractCompletedDesign({job:{status:"completed",result:{}}});',
  ], { encoding: 'utf8' });
  assert.strictEqual(r.status, 1, 'должен быть немедленный выход с ошибкой');
  assert.ok(r.stderr.includes('CANVA_JOB_FAILED'), r.stderr);
  assert.ok(r.stderr.includes('нет дизайна'), r.stderr);
});
