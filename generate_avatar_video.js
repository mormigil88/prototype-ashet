#!/usr/bin/env node
/**
 * generate_avatar_video.js — генерация видео с аватаром HeyGen.
 *
 * Интегрирован с heygen_avatar_registry.js:
 *   — preflight-проверка доступных аватаров перед платным запросом
 *   — автоматическое обновление ID при 404 (avatar not found)
 *   — выбор аватара по alias ("основной", "деловой"…) через CLI --avatar
 *   — понятные сообщения в stderr/stdout без API-ключей и внутренних ID
 *
 * Решение от 22.07.2026: HeyGen сам клонирует голос (clone_voice.js),
 * один вендор, отдельная загрузка аудио на промежуточный URL больше не нужна.
 *
 * Preflight-запрос (GET /v2/avatars) — бесплатный, запускается каждый раз.
 * При 404 avatar not found — одна попытка auto-recovery: обновить реестр,
 * подставить однозначную замену. Если замена неоднозначна — задача отменяется,
 * HeyGenFail выводится в stderr, код = HEYGEN_AVATAR_NOT_FOUND.
 *
 * CLI:
 *   node generate_avatar_video.js "<текст>" [story|square|landscape] [--avatar alias]
 *   node generate_avatar_video.js --avatars          # показать доступные аватары
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { archive }  = require('./media_archive');
const {
  HeyGenFail,
  selectAvatar,
  resolve404WithRecovery,
  listAvatarsSafe,
  fetchHeyGenAvatars,
  applyPreflight,
  loadRegistry,
  saveRegistry,
} = require('./heygen_avatar_registry');

const API_KEY  = process.env.HEYGEN_API_KEY;
const API_BASE = 'https://api.heygen.com';

const RATIOS = {
  story:     '9:16',
  square:    '1:1',
  landscape: '16:9',
};

// ─── Ошибки ───────────────────────────────────────────────────────────────────

function fail(msg, code) {
  console.error(msg);
  process.exit(code || 1);
}

function failHeyGen(err) {
  // Heisen-читаемое сообщение: без ключей, ID, путей
  console.error(`HeyGen: ${err.message}`);
  process.exit(1);
}

// ─── CLI-парсинг ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const result = { script: null, ratio: RATIOS.story, avatarAlias: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--avatar' && i + 1 < argv.length) {
      result.avatarAlias = argv[++i];
    } else if (a === '--avatars') {
      result.listAvatars = true;
    } else if (!result.script) {
      result.script = a;
    } else if (RATIOS[a]) {
      result.ratio = RATIOS[a];
    }
  }
  return result;
}

// ─── Видео: создание + поллинг ────────────────────────────────────────────────

async function createVideo(avatar_id, voice_id, script, ratio) {
  if (!API_KEY) fail('HEYGEN_API_KEY не задан — видео-аватар не подключён.');

  const headers = { 'x-api-key': API_KEY, 'Content-Type': 'application/json' };

  let createRes;
  try {
    createRes = await fetch(`${API_BASE}/v3/videos`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type:        'avatar',
        avatar_id,
        script,
        voice_id,
        aspect_ratio: ratio,
        resolution:  '1080p',
      }),
    });
  } catch (e) {
    fail('Ошибка сети при создании видео: ' + String(e.message || e));
  }

  const createBody = await createRes.json().catch(() => ({}));
  const videoId    = createBody?.data?.video_id;

  // 404 → пробуем auto-recovery один раз
  if (createRes.status === 404) {
    let recovery;
    try {
      recovery = await resolve404WithRecovery(avatar_id);
    } catch (err) {
      if (err instanceof HeyGenFail) failHeyGen(err);
      throw err;
    }
    // Повтор с новым ID
    const retryRes = await fetch(`${API_BASE}/v3/videos`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type:        'avatar',
        avatar_id:   recovery.avatar_id,
        script,
        voice_id:    recovery.voice_id || voice_id,
        aspect_ratio: ratio,
        resolution:  '1080p',
      }),
    });
    const retryBody = await retryRes.json().catch(() => ({}));
    const retryId   = retryBody?.data?.video_id;
    if (!retryRes.ok || !retryId) {
      failHeyGen(new HeyGenFail('HEYGEN_RETRY_FAILED',
        `Повторный запрос после 404 тоже не прошёл (${retryRes.status}): ${retryBody?.error?.message || JSON.stringify(retryBody)}`));
    }
    return { videoId: retryId, freshAvatarId: recovery.avatar_id };
  }

  if (!createRes.ok || !videoId) {
    // Heisen-безопасная ошибка: body может содержать sensitive-данные
    const safeMsg = createBody?.error?.message || createBody?.message || String(createRes.status);
    fail(`HeyGen отклонил задачу (${createRes.status}): ${safeMsg}`);
  }

  return { videoId, freshAvatarId: null };
}

async function pollVideo(videoId) {
  const headers = { 'x-api-key': API_KEY };

  const POLL_INTERVAL_MS = 5000;
  const MAX_WAIT_MS       = 5 * 60 * 1000;
  const startedAt         = Date.now();

  while (true) {
    if (Date.now() - startedAt > MAX_WAIT_MS) {
      fail(`Таймаут ожидания результата HeyGen (5 мин), video id: ${videoId}`);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

    let statusRes;
    try {
      statusRes = await fetch(`${API_BASE}/v3/videos/${videoId}`, { headers });
    } catch (e) {
      fail('Ошибка сети при проверке статуса: ' + String(e.message || e));
    }
    const statusBody = await statusRes.json().catch(() => ({}));
    const status     = statusBody?.data?.status;

    if (status === 'completed') {
      const videoUrl = statusBody.data.video_url;
      if (!videoUrl) fail('HeyGen вернул completed без video_url');

      let videoRes;
      try {
        videoRes = await fetch(videoUrl);
      } catch (e) {
        fail('Не удалось скачать готовое видео: ' + String(e.message || e));
      }
      const buf        = Buffer.from(await videoRes.arrayBuffer());
      const outputPath = path.join(os.tmpdir(), `ashet_avatar_${Date.now()}_${process.pid}.mp4`);
      fs.writeFileSync(outputPath, buf);
      return outputPath;
    }

    if (status === 'failed') {
      fail(`HeyGen: генерация не удалась — ${statusBody.data?.failure_message || 'без описания'} (${statusBody.data?.failure_code || '?'})`);
    }
    // pending / processing / waiting — продолжаем ждать
  }
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);

  // Показать список аватаров и выйти
  if (args.listAvatars) {
    if (!API_KEY) fail('HEYGEN_API_KEY не задан — видео-аватар не подключён.');

    // Preflight: актуализируем список из HeyGen
    let registry = loadRegistry() || { avatars: [], _pending: [], default_alias: 'основной' };
    try {
      const heygenAvatars = await fetchHeyGenAvatars();
      applyPreflight(registry, heygenAvatars);
      saveRegistry(registry);
    } catch (err) {
      console.error(`Preflight не прошёл — не могу показать актуальный список аватаров: ${err.message}`);
      process.exit(1);
    }

    const { choices, default_number } = listAvatarsSafe();
    if (choices.length === 0) {
      console.log('HeyGen не знает ни одного аватара в этом аккаунте.');
      return;
    }

    console.log(`Доступные аватары (по умолчанию: ${default_number}):\n`);
    choices.forEach((c) => {
      const marker = c.number === default_number ? ' ← основной' : '';
      const statusLabel = c.status === 'active' ? '✓' : '✗';
      console.log(`  ${c.number}. "${c.name}" [${c.alias}] ${statusLabel}${marker}`);
    });
    console.log('\nВыбрать: node generate_avatar_video.js "текст" --avatar "основной"');
    return;
  }

  if (!args.script) {
    fail('Использование: node generate_avatar_video.js "<текст сценария>" [story|square|landscape] [--avatar алиас]');
  }

  // Выбираем аватар через реестр (с preflight)
  let avatarInfo;
  try {
    avatarInfo = await selectAvatar({ preferAlias: args.avatarAlias, doPreflight: true });
  } catch (err) {
    if (err instanceof HeyGenFail) failHeyGen(err);
    throw err;
  }

  console.error(`[HeyGen] Используется аватар: "${avatarInfo.name}" [${avatarInfo.alias}]`);

  let videoId;
  try {
    ({ videoId } = await createVideo(avatarInfo.avatar_id, avatarInfo.voice_id, args.script, args.ratio));
  } catch (err) {
    if (err instanceof HeyGenFail) failHeyGen(err);
    throw err;
  }

  console.error(`[HeyGen] Задача отправлена, video id: ${videoId}`);

  const outputPath = await pollVideo(videoId);

  // Архивируем в R2
  const ar = await archive(outputPath, {
    provider:        'heygen',
    providerJobId:   videoId,
    clientSlug:      process.env.CLIENT_SLUG || 'ashet-irina',
    sourceUrl:       null,
    script:          args.script,
    aspectRatio:     args.ratio,
    contentType:     'video/mp4',
  });
  if (!ar.ok || ar.status !== 'done') {
    console.error(`Archive failed: ${ar.reason} (videoId=${videoId})`);
    fail('R2 archive error');
  }

  console.log(outputPath);
}

main().catch(e => {
  if (e instanceof HeyGenFail) failHeyGen(e);
  console.error('Непредвиденная ошибка:', e.message);
  process.exit(1);
});
