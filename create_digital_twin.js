#!/usr/bin/env node
/**
 * create_digital_twin.js — создание HeyGen Digital Twin по видео.
 *
 * После успешного создания аватар регистрируется в heygen_avatar_registry.
 * Legacy-файл /data/heygen_irina_digital_twin.json также обновляется
 * (обратная совместимость). При первом запуске существующий Digital Twin
 * из legacy-файла мигрируется в реестр автоматически.
 *
 * Запуск: после явного согласия Иры.
 *   node create_digital_twin.js "Irina" <training-video.mp4> [--name "Ирина Деловой"]
 */

const fs   = require('fs');
const path = require('path');

const API_KEY    = process.env.HEYGEN_API_KEY;
const API_BASE   = 'https://api.heygen.com';
const CONFIG_PATH = process.env.HEYGEN_IRINA_LEGACY || '/data/heygen_irina_digital_twin.json';

const { registerAvatar, updateVoiceId, HeyGenFail } = require('./heygen_avatar_registry');

function fail(msg) { console.error(msg); process.exit(1); }
async function json(r) { return r.json().catch(() => ({})); }

// ─── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const result = { name: null, videoPath: null, registryAlias: 'основной' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--name' && i + 1 < argv.length) {
      result.registryAlias = argv[++i];
    } else if (!result.name) {
      result.name = argv[i];
    } else if (!result.videoPath) {
      result.videoPath = argv[i];
    }
  }
  return result;
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!API_KEY) fail('HEYGEN_API_KEY не задан в окружении.');

  const args = parseArgs(process.argv);
  if (!args.name || !args.videoPath) {
    fail('Использование: node create_digital_twin.js "Irina" <training-video.mp4> [--name "алиас"]');
  }
  if (!fs.existsSync(args.videoPath)) fail('Файл не найден: ' + args.videoPath);
  if (fs.statSync(args.videoPath).size < 1024) fail('Файл слишком мал: нужен полноценный MP4-фрагмент.');

  const headers = { 'x-api-key': API_KEY };
  const form    = new FormData();
  form.append('file', new Blob([fs.readFileSync(args.videoPath)], { type: 'video/mp4' }), path.basename(args.videoPath));

  // 1. Загрузка видео
  const uploadResponse = await fetch(`${API_BASE}/v3/assets`, { method: 'POST', headers, body: form });
  const upload         = await json(uploadResponse);
  const assetId        = upload?.data?.asset_id || upload?.asset_id;
  if (!uploadResponse.ok || !assetId) {
    fail(`HeyGen отклонил загрузку видео (${uploadResponse.status}): ${upload?.error?.message || JSON.stringify(upload)}`);
  }

  // 2. Создание Digital Twin
  const createResponse = await fetch(`${API_BASE}/v3/avatars`, {
    method:  'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ type: 'digital_twin', name: args.name, file: { type: 'asset_id', asset_id: assetId } }),
  });
  const created = await json(createResponse);
  const item    = created?.data?.avatar_item;
  const group   = created?.data?.avatar_group;
  if (!createResponse.ok || !item?.id || !group?.id) {
    fail(`HeyGen отклонил создание Digital Twin (${createResponse.status}): ${created?.error?.message || JSON.stringify(created)}`);
  }

  const avatarId = item.id;
  const voiceId  = item.default_voice_id || null;

  // 3. Сохраняем legacy-файл (обратная совместимость)
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    avatar_id:      avatarId,
    group_id:       group.id,
    voice_id:       voiceId,
    status:         item.status,
    consent_status: group.consent_status || 'pending',
    created_at:     new Date().toISOString(),
  }, null, 2));

  // 4. Регистрируем в реестре
  let registryEntry;
  try {
    registryEntry = registerAvatar({
      alias:    args.registryAlias,
      name:     `Ирина "${args.registryAlias}"`,
      type:     'digital_twin',
      avatar_id: avatarId,
      voice_id:  voiceId,
      status:   item.status === 'active' ? 'active' : 'pending_consent',
    });
  } catch (err) {
    if (err instanceof HeyGenFail && err.code === 'HEYGEN_DUPLICATE_ALIAS') {
      // Алиас уже есть — обновляем avatar_id у существующего
      console.error(`[create_digital_twin] Алиас «${args.registryAlias}» уже зарегистрирован, обновляю ID…`);
      // Перерегистрируем под новым alias
      try {
        registryEntry = registerAvatar({
          alias:    `${args.registryAlias}-${Date.now()}`,
          name:     `Ирина "${args.registryAlias}" (${args.name})`,
          type:     'digital_twin',
          avatar_id: avatarId,
          voice_id:  voiceId,
          status:   item.status === 'active' ? 'active' : 'pending_consent',
        });
      } catch (err2) {
        // Крайний случай — выходим, но legacy-файл уже сохранён
        fail(`Реестр: ${err2.message}. Legacy-файл сохранён, попробуйте: node heygen_avatar_registry.js list`);
      }
    } else {
      throw err;
    }
  }

  // 5. Запрос consent URL
  const consentResponse = await fetch(`${API_BASE}/v3/avatars/${encodeURIComponent(group.id)}/consent`, {
    method:  'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body:    JSON.stringify({}),
  });
  const consent    = await json(consentResponse);
  const consentUrl = consent?.data?.url;
  if (!consentResponse.ok || !consentUrl) {
    console.error(`[create_digital_twin] ВНИМАНИЕ: Digital Twin создан (ID: ${avatarId}), но consent URL не получен (${consentResponse.status}). Legacy-файл и реестр обновлены. Повторите с --consent позже.`);
    // Не выходим ошибкой — аватар уже зарегистрирован, consent можно запросить отдельно
  }

  // 6. Удаляем исходное видео
  fs.rmSync(args.videoPath, { force: true });

  const result = {
    avatar_id:   avatarId,
    group_id:    group.id,
    status:      item.status,
    consent_url: consentUrl || null,
    registry_alias: registryEntry.alias,
    message: consentUrl
      ? 'Ира должна открыть ссылку и записать подтверждение в течение 24 часов. До этого двойника использовать нельзя.'
      : 'Digital Twin создан, но ссылка на consent не получена. Попробуйте node create_digital_twin.js --consent.',
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch(e => {
  if (e instanceof HeyGenFail) {
    console.error(`HeyGen: ${e.message}`);
  } else {
    console.error('Ошибка Digital Twin: ' + (e.message || String(e)));
  }
  process.exit(1);
});
