#!/usr/bin/env node
/**
 * generate_tts_audio.js — генерация аудио через HeyGen Text-to-Speech API.
 *
 * Использует POST /v3/voices/speech — чистый TTS без видео.
 * voice_id берётся из реестра аватаров (heygen_avatar_registry.js).
 *
 * CLI:
 *   node generate_tts_audio.js "<текст>"
 *   node generate_tts_audio.js "<текст>" --speed 1.2
 *   node generate_tts_audio.js "<текст>" --voice-id <voice_id>
 *
 * stdout: путь к MP3-файлу
 * errors: в stderr, без ключей и ID
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { archive } = require('./media_archive');
const {
  HeyGenFail,
  selectAvatar,
  loadRegistry,
} = require('./heygen_avatar_registry');

const API_KEY  = process.env.HEYGEN_API_KEY;
const API_BASE = 'https://api.heygen.com';

// ─── Ошибки ───────────────────────────────────────────────────────────────────

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function failHeyGen(err) {
  console.error(`HeyGen TTS: ${err.message}`);
  process.exit(1);
}

// ─── CLI-парсинг ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const result = { script: null, speed: 1.0, voiceId: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--speed' && i + 1 < argv.length) {
      result.speed = parseFloat(argv[++i]);
    } else if (a === '--voice-id' && i + 1 < argv.length) {
      result.voiceId = argv[++i];
    } else if (!result.script) {
      result.script = a;
    }
  }
  return result;
}

// ─── TTS: синтез речи ────────────────────────────────────────────────────────

/**
 * Генерирует аудио через HeyGen TTS API.
 * @param {string} voiceId
 * @param {string} text
 * @param {number} speed  0.5–2.0
 * @returns {Promise<{audioUrl: string, duration: number, requestId: string}>}
 */
async function synthesizeVoice(voiceId, text, speed = 1.0) {
  if (!API_KEY) fail('HEYGEN_API_KEY не задан — TTS не подключён.');

  const headers = { 'x-api-key': API_KEY, 'Content-Type': 'application/json' };

  let res;
  try {
    res = await fetch(`${API_BASE}/v3/voices/speech`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        voice_id:   voiceId,
        text:       text.slice(0, 5000),
        speed:      speed,
        input_type: 'text',
      }),
    });
  } catch (e) {
    fail('Ошибка сети при запросе TTS: ' + String(e.message || e));
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.data?.audio_url) {
    const safeMsg = body?.error?.message || body?.message || String(res.status);
    fail(`HeyGen TTS отклонил задачу (${res.status}): ${safeMsg}`);
  }

  return {
    audioUrl:   body.data.audio_url,
    duration:   body.data.duration,
    requestId:  body.data.request_id,
  };
}

// ─── Загрузка MP3 ─────────────────────────────────────────────────────────────

/**
 * Скачивает MP3 по URL и сохраняет локально.
 * @param {string} url
 * @returns {Promise<string>} локальный путь
 */
async function downloadAudio(url) {
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    fail('Не удалось скачать аудио: ' + String(e.message || e));
  }
  if (!res.ok) {
    fail(`HeyGen вернул HTTP ${res.status} при скачивании аудио`);
  }
  let buf;
  try {
    buf = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    fail('Не удалось прочитать тело аудио: ' + String(e.message || e));
  }
  const outPath = path.join(os.tmpdir(), `heygen_tts_${Date.now()}_${process.pid}.mp3`);
  fs.writeFileSync(outPath, buf);
  return outPath;
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  if (!args.script) {
    fail('Использование: node generate_tts_audio.js "<текст>" [--speed 1.2] [--voice-id <id>]');
  }

  // voice_id: из аргумента или из реестра
  let voiceId = args.voiceId;
  if (!voiceId) {
    try {
      const avatarInfo = await selectAvatar({ preferAlias: null, doPreflight: false });
      voiceId = avatarInfo.voice_id;
    } catch (err) {
      if (err instanceof HeyGenFail) failHeyGen(err);
      throw err;
    }
    if (!voiceId) {
      fail('voice_id не найден: ни передан, ни найден в реестре аватаров Ирины');
    }
  }

  let ttsResult;
  try {
    ttsResult = await synthesizeVoice(voiceId, args.script, args.speed);
  } catch (err) {
    if (err instanceof HeyGenFail) failHeyGen(err);
    throw err;
  }

  console.error(`[HeyGen TTS] Длительность: ${ttsResult.duration} сек., request_id: ${ttsResult.requestId}`);

  let mp3Path;
  try {
    mp3Path = await downloadAudio(ttsResult.audioUrl);
  } catch (e) {
    fail('Не удалось скачать аудио: ' + e.message);
  }

  // Архивируем MP3 в R2
  const ar = await archive(mp3Path, {
    provider:        'heygen',
    providerJobId:   ttsResult.requestId,
    clientSlug:      process.env.CLIENT_SLUG || 'ashet-irina',
    sourceUrl:       ttsResult.audioUrl,
    script:          args.script,
    contentType:     'audio/mpeg',
  });
  if (!ar.ok || ar.status !== 'done') {
    console.error(`Archive failed: ${ar.reason} — MP3 сохранён локально`);
    // не фатальная ошибка — файл на диске
  }

  console.log(mp3Path);
}

if (require.main === module) {
  main().catch(e => {
    if (e instanceof HeyGenFail) failHeyGen(e);
    console.error('Непредвиденная ошибка:', e.message);
    process.exit(1);
  });
}

module.exports = { parseArgs, synthesizeVoice, downloadAudio };
