#!/usr/bin/env node
// ОДНОРАЗОВЫЙ OAuth для Canva Connect. Запускается ЛОКАЛЬНО у Андрея, НЕ в контейнере.
// Результат — canva_tokens.json с access+refresh токеном Иры. Дальше контейнер живёт
// на ротации refresh-токенов сам (см. canva_render.js): каждый refresh выдаёт НОВЫЙ
// refresh-токен, поэтому файл с этого момента — единственный источник истины, а сид в
// env (если заливали CANVA_REFRESH_TOKEN_SEED) умирает после первого refresh в контейнере.
//
// Использование:
//   CANVA_CLIENT_ID=... CANVA_CLIENT_SECRET=... node canva_oauth.js [--port 8571] [--out canva_tokens.json]
//
// Перед запуском: redirect URL http://127.0.0.1:8571/callback должен быть добавлен
// в интеграцию (Developer Portal → Authentication → Authorized redirects).

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const SCOPES = [
  'brandtemplate:read',
  'brandtemplate:content:write', // autofill по бренд-шаблонам
  'design:content:write',        // создание дизайна + экспорт
  'asset:read',
  'asset:write',                 // загрузка фото/видео Иры как ассетов
].join(' ');

function fail(msg) {
  console.error('ОШИБКА: ' + msg);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { args[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const clientId = process.env.CANVA_CLIENT_ID || args['client-id'];
  const clientSecret = process.env.CANVA_CLIENT_SECRET || args['client-secret'];
  const port = parseInt(args.port || '8571', 10);
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const outFile = args.out || 'canva_tokens.json';
  if (!clientId || !clientSecret) {
    fail('Нужны CANVA_CLIENT_ID и CANVA_CLIENT_SECRET (env или --client-id/--client-secret). Креды интеграции Иры — из 1Password.');
  }

  // PKCE
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('hex');

  const authUrl = new URL('https://www.canva.com/api/oauth/authorize');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', state);

  const codePromise = new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, redirectUri);
      if (url.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h2>Canva: авторизация принята</h2><p>Можешь закрыть эту вкладку и вернуться в терминал.</p>');
      clearTimeout(timer);
      server.close();
      resolve(url);
    });
    const timer = setTimeout(() => { server.close(); reject(new Error('таймаут ожидания redirect (5 минут)')); }, 5 * 60_000);
    server.listen(port, '127.0.0.1', () => {
      console.log(`Слушаю ${redirectUri}`);
      console.log('\nОткрываю браузер для авторизации Ирой (логин её Canva-аккаунта, с MFA)...\n');
      console.log(authUrl.toString() + '\n');
      const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
      execFile(opener, [authUrl.toString()], () => {});
    });
    server.on('error', (e) => reject(new Error(`порт ${port} занят? (${e.message})`)));
  });

  const url = await codePromise;
  if (url.searchParams.get('state') !== state) fail('state не совпал — подозрение на подмену redirect, прерываю');
  const error = url.searchParams.get('error');
  if (error) fail(`Canva вернул ошибку авторизации: ${error} (${url.searchParams.get('error_description') || ''})`);
  const code = url.searchParams.get('code');
  if (!code) fail('В redirect нет code');

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const resp = await fetch('https://api.canva.com/rest/v1/oauth/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }),
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) fail(`Обмен code на токены упал: HTTP ${resp.status} ${JSON.stringify(body).slice(0, 400)}`);

  const tokens = {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_at: Date.now() + (body.expires_in || 14400) * 1000,
    scope: body.scope,
    obtained_at: new Date().toISOString(),
  };
  fs.writeFileSync(outFile, JSON.stringify(tokens, null, 2));
  console.log(`\nГотово. Токены записаны в ${path.resolve(outFile)}`);
  console.log(`Scope: ${tokens.scope || SCOPES}`);
  console.log('\nДальше (один из вариантов):');
  console.log(`  1) Залить ${path.basename(outFile)} на volume контейнера как /data/canva_tokens.json — предпочтительно, survives редеплои.`);
  console.log('  2) Значение refresh_token → Railway Variable CANVA_REFRESH_TOKEN_SEED (временный bootstrap; после первого refresh в контейнере сид мёртв — переменную удалить).');
  console.log('\nПроверка в контейнере: node /app/canva_render.js --check');
}

main().catch(e => fail(e.message));
