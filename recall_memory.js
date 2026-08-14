// Загружает уровни 2-3 памяти (episodic+semantic) с memory-gateway на neurostaff
// ДО старта Claude Code и дописывает их в CLAUDE.md — так Ашет получает контекст
// прошлых сессий системным промптом ещё до первой реплики Ольги, а не полагается
// на то, что сам вызовет /recall по инструкции в CLAUDE.md (модель может пропустить
// этот шаг, он не обязателен на уровне рантайма). См. project_ashet_channels_bots.md.
//
// Никогда не роняет запуск: при недоступном гейте/ошибке печатает предупреждение
// в stderr и выходит с кодом 0 — entrypoint.sh продолжает с базовым CLAUDE.md.
// Никогда не печатает MEMORY_GATEWAY_SECRET.
const http = require('http');
const https = require('https');
const fs = require('fs');
const { URL } = require('url');

const RECALL_URL = process.env.MEMORY_GATEWAY_URL_RECALL || '';
const SECRET = process.env.MEMORY_GATEWAY_SECRET || '';
const CLAUDE_MD = '/app/CLAUDE.md';
const CLIENT_SLUG = process.env.CLIENT_SLUG || '';
const QUERY = 'важные факты, договорённости, последние задачи, незавершённые действия';
// 20с, не 10 — живой замер (15.07.2026) показал стабильные ~9-10.3с на каждый
// вызов /recall (эмбеддинг запроса + два похода в RUVDS через океан), 10с давали
// таймаут в 2 из 3 попыток. Разовая стоимость при старте контейнера, не в горячем
// пути ответа Ольге — оправдано подождать чуть дольше ради реальной памяти.
const TIMEOUT_MS = 20000;

function warn(msg) {
  console.error(`[recall_memory] ${msg}`);
}

function done() {
  process.exit(0);
}

if (!RECALL_URL || !SECRET) {
  warn('MEMORY_GATEWAY_URL_RECALL/MEMORY_GATEWAY_SECRET не заданы — запуск без памяти прошлых сессий');
  done();
}

if (!CLIENT_SLUG) {
  warn('CLIENT_SLUG не задан — запуск без памяти прошлых сессий (без slug нельзя безопасно обращаться к memory-gateway)');
  done();
}

let url;
try {
  url = new URL(RECALL_URL);
} catch (e) {
  warn('MEMORY_GATEWAY_URL_RECALL не является валидным URL — запуск без памяти прошлых сессий');
  done();
}

const body = JSON.stringify({ client_slug: CLIENT_SLUG, query: QUERY });
const client = url.protocol === 'https:' ? https : http;

const req = client.request(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Gateway-Secret': SECRET,
    'Content-Length': Buffer.byteLength(body),
  },
  timeout: TIMEOUT_MS,
}, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch (e) {
      warn('не удалось разобрать ответ memory-gateway — запуск без памяти прошлых сессий');
      done();
      return;
    }
    if (!parsed || parsed.ok !== true) {
      warn('memory-gateway ответил без ok:true — запуск без памяти прошлых сессий');
      done();
      return;
    }
    const facts = Array.isArray(parsed.facts) ? parsed.facts : [];
    const summaries = Array.isArray(parsed.summaries) ? parsed.summaries : [];
    if (!facts.length && !summaries.length) {
      warn('memory-gateway не вернул фактов/summary (новый клиент?) — запуск без доп. контекста');
      done();
      return;
    }

    let section = '\n\n## Память с прошлых сессий (загружено автоматически при старте)\n\n';
    if (summaries.length) {
      section += '### Резюме прошлых разговоров\n\n';
      summaries.forEach((s) => { section += `- ${s}\n`; });
      section += '\n';
    }
    if (facts.length) {
      section += '### Отдельные факты\n\n';
      facts.forEach((f) => { section += `- ${f}\n`; });
      section += '\n';
    }

    try {
      fs.appendFileSync(CLAUDE_MD, section);
    } catch (e) {
      warn('не удалось записать память в CLAUDE.md — запуск без памяти прошлых сессий');
      done();
      return;
    }
    warn(`память загружена: ${summaries.length} summary, ${facts.length} фактов`);
    done();
  });
});

req.on('timeout', () => {
  warn(`memory-gateway не ответил за ${TIMEOUT_MS}мс — запуск без памяти прошлых сессий`);
  req.destroy();
  done();
});

req.on('error', () => {
  warn('memory-gateway недоступен — запуск без памяти прошлых сессий');
  done();
});

req.write(body);
req.end();
