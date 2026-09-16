#!/usr/bin/env node
/**
 * heygen_avatar_registry.js — реестр аватаров HeyGen с preflight-проверкой.
 *
 * Реестр хранится в JSON (по умолчанию /data/heygen/avatar_registry.json).
 * Каждая запись: { id, alias, name, type, status, avatar_id, voice_id, created_at, last_verified_at }
 *
 * Алиасы — понятные короткие ключи для выбора аватара:
 *   "основной"  — primary active avatar, используется по умолчанию
 *   "деловой"  — secondary avatar
 *   "улыбка"   — avatar with smiling expression
 *   и т.д.
 *
 * При первом запуске выполняется автоматическая миграция:
 *   1. Из digital twin файла /data/heygen_irina_digital_twin.json
 *   2. Из env: HEYGEN_AVATAR_ID_IRINA, HEYGEN_VOICE_ID_IRINA
 * Мигрированный аватар получает alias "основной".
 *
 * Preflight-проверка (GET /v1/avatars) — бесплатная, выполняется перед
 * любой платной генерацией. Обновляет статусы в реестре.
 *
 * Коды ошибок (HeyGenFail.code):
 *   HEYGEN_REGISTRY_NOT_FOUND       — реестр не существует и не удалось создать
 *   HEYGEN_NO_AVATARS              — preflight вернул пустой список
 *   HEYGEN_AVATAR_NOT_FOUND        — запрошенный avatar_id не найден в HeyGen
 *   HEYGEN_AVATAR_INACTIVE         — аватар существует, но неактивен
 *   HEYGEN_AMBIGUOUS_REPLACEMENT   — несколько подходящих аватаров, нужен ручной выбор
 *   HEYGEN_PREFIGHT_FAILED          — preflight-запрос к HeyGen не прошёл
 *   HEYGEN_DUPLICATE_ALIAS         — при миграции обнаружен конфликт алиасов
 *
 * CLI-команды:
 *   node heygen_avatar_registry.js list                   — показать все аватары
 *   node heygen_avatar_registry.js get [alias]            — получить active avatar_id
 *   node heygen_avatar_registry.js set-default <alias>     — переключить аватар по умолчанию
 *   node heygen_avatar_registry.js preflight              — принудительный preflight
 *   node heygen_avatar_registry.js migrate                — принудительная миграция из legacy-источников
 */

const fs = require('fs');
const path = require('path');

// ─── Константы ────────────────────────────────────────────────────────────────

const API_KEY         = process.env.HEYGEN_API_KEY;
const API_BASE        = 'https://api.heygen.com';
const LEGACY_CONFIG   = process.env.HEYGEN_IRINA_LEGACY || '/data/heygen_irina_digital_twin.json';
const REGISTRY_DIR   = process.env.HEYGEN_REGISTRY_DIR  || '/data/heygen';
const REGISTRY_FILE   = path.join(REGISTRY_DIR, 'avatar_registry.json');
const DEFAULT_ALIAS   = 'основной';

// ─── Low-level HTTP ───────────────────────────────────────────────────────────

class HeyGenFail extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function heygenGET(pathname) {
  if (!API_KEY) throw new HeyGenFail('HEYGEN_NO_API_KEY', 'HEYGEN_API_KEY не задан в окружении');
  const res = await fetch(`${API_BASE}${pathname}`, {
    headers: { 'x-api-key': API_KEY },
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

// ─── Реестр: загрузка / сохранение ───────────────────────────────────────────

function loadRegistry() {
  if (!fs.existsSync(REGISTRY_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveRegistry(registry) {
  fs.mkdirSync(REGISTRY_DIR, { recursive: true });
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
}

function initRegistry() {
  const now = new Date().toISOString();
  return {
    version: 1,
    updated_at: now,
    avatars: [],   // массив записей AvatarEntry
    default_alias: DEFAULT_ALIAS,
  };
}

// ─── Запись аватара ────────────────────────────────────────────────────────────

/**
 * @typedef {Object} AvatarEntry
 * @property {string} id            — UUID записи (не avatar_id!)
 * @property {string} alias        — короткий алиас ("основной", "деловой"…)
 * @property {string} name         — человеческое имя ("Ирина Деловой", "Ирина Улыбка"…)
 * @property {'digital_twin'|'photo'|'video'} type
 * @property {'active'|'inactive'|'training'|'pending_consent'} status
 * @property {string} avatar_id    — HeyGen avatar_id
 * @property {string|null} voice_id
 * @property {string} created_at
 * @property {string} last_verified_at
 */

function makeEntry(avatar_id, { alias, name = alias, type = 'digital_twin', status = 'active', voice_id = null } = {}) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    alias,
    name,
    type,
    status,
    avatar_id,
    voice_id,
    created_at: new Date().toISOString(),
    last_verified_at: new Date().toISOString(),
  };
}

// ─── Миграция из legacy-источников ─────────────────────────────────────────────

function migrateFromLegacy(registry) {
  const now = new Date().toISOString();
  let changed = false;

  // Собираем претендентов: { source, avatar_id, voice_id, status, name }
  const candidates = [];

  // 1. digital twin config
  if (fs.existsSync(LEGACY_CONFIG)) {
    try {
      const twin = JSON.parse(fs.readFileSync(LEGACY_CONFIG, 'utf8'));
      if (twin.avatar_id) {
        candidates.push({ source: 'legacy', avatar_id: twin.avatar_id, voice_id: twin.voice_id || null, status: twin.status || 'active', name: 'Ирина Digital Twin' });
      }
    } catch { /* ignore */ }
  }

  // 2. env HEYGEN_AVATAR_ID_IRINA
  const envAvatarId = process.env.HEYGEN_AVATAR_ID_IRINA;
  if (envAvatarId) {
    candidates.push({ source: 'env', avatar_id: envAvatarId, voice_id: null, status: 'active', name: 'Ирина (аватар из env)' });
  }

  // Дедупликация: уникальные avatar_id
  const seen = new Set();
  const uniq = candidates.filter(c => {
    if (seen.has(c.avatar_id)) return false;
    seen.add(c.avatar_id);
    return true;
  });

  // Назначаем alias: первый = "основной", остальные = уникальные
  for (let i = 0; i < uniq.length; i++) {
    const c = uniq[i];
    const alias = i === 0 ? DEFAULT_ALIAS : `${DEFAULT_ALIAS}-${i + 1}`;
    if (!registry.avatars.some(a => a.avatar_id === c.avatar_id)) {
      registry.avatars.push(makeEntry(c.avatar_id, {
        alias,
        name:   c.name,
        type:   'digital_twin',
        status: c.status === 'active' ? 'active' : 'inactive',
        voice_id: c.voice_id,
      }));
      changed = true;
    }
  }

  if (changed) registry.updated_at = now;
  return changed;
}

// ─── Preflight: получаем живые аватары из HeyGen ─────────────────────────────

/**
 * Нормализация status из HeyGen v2 API → внутренний формат реестра.
 *
 * HeyGen v2 возвращает:
 *   "training"        — Digital Twin ещё обучается
 *   "available"       — готов к использованию
 *   "unavailable"    — временно недоступен
 *   "error"           — ошибка при обучении
 *   (отсутствует)     — аватар есть в списке = available/active
 *
 * Реестр использует: "active" | "inactive" | "training" | "pending_consent"
 */
function normalizeStatus(hgStatus) {
  // Отсутствие поля = аватар в списке HeyGen = available
  if (hgStatus === undefined || hgStatus === null || hgStatus === '') return 'active';
  switch (String(hgStatus).toLowerCase()) {
    case 'available':  return 'active';    // HeyGen v2: готов к использованию
    case 'active':   return 'active';    // HeyGen v1 / совместимость
    case 'training': return 'training';  // Digital Twin ещё обучается
    case 'unavailable':
    case 'error':    return 'inactive';  // временно недоступен / ошибка
    default:         return 'inactive';
  }
}

/**
 * Возвращает массив { avatar_id, name, status, type } из HeyGen.
 * Выбрасывает HeyGenFail при ошибке.
 */
async function fetchHeyGenAvatars() {
  if (!API_KEY) throw new HeyGenFail('HEYGEN_NO_API_KEY', 'HEYGEN_API_KEY не задан');

  // GET /v2/avatars — список всех аватаров аккаунта
  const { ok, status, body } = await heygenGET('/v2/avatars');
  if (!ok) {
    throw new HeyGenFail('HEYGEN_PREFLIGHT_FAILED',
      `HeyGen preflight не прошёл (${status}): ${JSON.stringify(body)}`);
  }

  // body = { avatars: [...] } или { data: { avatars: [...] } }
  const avatars = body.avatars ?? body.data?.avatars ?? [];
  return avatars.map(a => ({
    avatar_id: a.avatar_id ?? a.id,
    name:      a.name      ?? '(без имени)',
    status:    normalizeStatus(a.status),
    type:      a.type      ?? 'unknown',
  }));
}

// ─── Обновление реестра по результатам preflight ───────────────────────────────

function applyPreflight(registry, heygenAvatars) {
  const now = new Date().toISOString();
  const hgMap = new Map(heygenAvatars.map(a => [a.avatar_id, a]));

  // Обновляем known-аватары: меняем статус если HeyGen сообщил иначе
  for (const entry of registry.avatars) {
    const hg = hgMap.get(entry.avatar_id);
    if (hg) {
      // HeyGen знает этого аватара
      entry.status          = hg.status;
      entry.last_verified_at = now;
      hgMap.delete(entry.avatar_id);
    } else {
      // HeyGen больше не знает этого аватара → помечаем inactive
      if (entry.status !== 'inactive') {
        entry.status = 'inactive';
        entry.last_verified_at = now;
      }
    }
  }

  // Новые аватары из HeyGen, которых нет в реестре — НЕ добавляем автоматически.
  // Ирина должна сама принять решение, нужен ли новый аватар.
  // Сохраняем их в _pending — они пригодятся для сообщения при выборе.
  registry._pending = Array.from(hgMap.values());
  registry.updated_at = now;
}

// ─── Публичное API ────────────────────────────────────────────────────────────

/**
 * Выбрать avatar_id для рендера.
 *
 * @param {Object} opts
 * @param {string} [opts.preferAlias]  — желаемый алиас ("основной", "деловой"…)
 * @param {boolean} [opts.doPreflight=true] — делать ли preflight
 * @param {boolean} [opts.interactive=true] — разрешать ли интерактивный выбор (interactive-режим)
 * @returns {Promise<{avatar_id:string, voice_id:string|null, alias:string, name:string, fresh:boolean}>}
 * @throws {HeyGenFail}
 */
async function selectAvatar({ preferAlias = null, doPreflight = true, interactive = true } = {}) {
  // 1. Загрузить или создать реестр
  let registry = loadRegistry();
  if (!registry) {
    registry = initRegistry();
    if (migrateFromLegacy(registry)) saveRegistry(registry);
  } else if (registry.avatars.length === 0) {
    // Пустой реестр — пробуем мигрировать
    if (migrateFromLegacy(registry)) saveRegistry(registry);
  }

  // 2. Preflight: актуализируем статусы. Ошибка = выход, рендер не запускается.
  let heygenAvatars = [];
  if (doPreflight) {
    try {
      heygenAvatars = await fetchHeyGenAvatars();
      applyPreflight(registry, heygenAvatars);
      saveRegistry(registry);
    } catch (err) {
      // КРИТИЧНО: при любой ошибке preflight — НЕ используем кеш, НЕ шлём POST.
      // Рендер не запускается, кредиты не тратятся.
      if (err instanceof HeyGenFail) throw err;
      throw new HeyGenFail('HEYGEN_PREFLIGHT_FAILED', String(err.message));
    }
  }

  // 3. Пытаемся выбрать по алиасу
  const aliasToUse = preferAlias || registry.default_alias || DEFAULT_ALIAS;
  const byAlias = registry.avatars.find(a => a.alias === aliasToUse);

  if (byAlias && byAlias.status === 'active') {
    return {
      avatar_id: byAlias.avatar_id,
      voice_id:  byAlias.voice_id,
      alias:     byAlias.alias,
      name:      byAlias.name,
      fresh:     false,
    };
  }

  // 4. Сохранённый ID не активен или не найден → ищем замену
  if (byAlias && byAlias.status !== 'active') {
    // Собираем активные: известные реестру + из _pending
    const knownActive = registry.avatars.filter(a => a.status === 'active');
    const pendingActive = (registry._pending || []).filter(p => p.status === 'active');

    if (knownActive.length + pendingActive.length === 1) {
      // Один активный — берём его (из known или pending)
      let replacement;
      if (knownActive.length === 1) {
        replacement = knownActive[0];
        replacement.last_verified_at = new Date().toISOString();
      } else {
        const p = pendingActive[0];
        replacement = makeEntry(p.avatar_id, {
          alias:    DEFAULT_ALIAS,
          name:     p.name,
          type:     p.type || 'digital_twin',
          status:   'active',
        });
        registry.avatars.push(replacement);
      }
      registry._pending = [];
      registry.updated_at = new Date().toISOString();
      saveRegistry(registry);
      return {
        avatar_id: replacement.avatar_id,
        voice_id:  replacement.voice_id,
        alias:     replacement.alias,
        name:      replacement.name,
        fresh:     true,
      };
    }
    if (knownActive.length + pendingActive.length === 0) {
      if (interactive) {
        throw new HeyGenFail('HEYGEN_AVATAR_INACTIVE',
          `Выбранный аватар больше не активен в HeyGen. Активных аватаров не найдено. Требуется выбор нового аватара.`);
      }
    } else {
      if (interactive) {
        throw new HeyGenFail('HEYGEN_AMBIGUOUS_REPLACEMENT',
          `Аватар «${aliasToUse}» неактивен, но в аккаунте несколько активных аватаров. ` +
          `Ирина, выберите нужный через --avatar или heygen_avatar_registry.js list`);
      }
    }
  }

  // 5. Записей нет вообще → пытаемся из _pending
  if (registry.avatars.length === 0) {
    if (registry._pending?.length === 1) {
      // Один новый аватар — добавляем в реестр и используем
      const p = registry._pending[0];
      const entry = makeEntry(p.avatar_id, {
        alias: DEFAULT_ALIAS,
        name:  p.name,
        type:  p.type || 'digital_twin',
        status: normalizeStatus(p.status),
      });
      registry.avatars.push(entry);
      registry.updated_at = new Date().toISOString();
      saveRegistry(registry);
      return { avatar_id: entry.avatar_id, voice_id: entry.voice_id, alias: entry.alias, name: entry.name, fresh: true };
    }
    if (registry._pending?.length > 1 && interactive) {
      throw new HeyGenFail('HEYGEN_AMBIGUOUS_REPLACEMENT',
        `В HeyGen обнаружено ${registry._pending.length} аватаров без регистрации. ` +
        `Ирина, выберите нужный аватар через --avatar или выполните node heygen_avatar_registry.js list`);
    }
    // Нет pending и нет записей → миграция из legacy
    migrateFromLegacy(registry);
    saveRegistry(registry);
    const def = registry.avatars[0];
    if (def) {
      return { avatar_id: def.avatar_id, voice_id: def.voice_id, alias: def.alias, name: def.name, fresh: false };
    }
  }

  // 6. Нет ни одного активного аватара
  throw new HeyGenFail('HEYGEN_NO_AVATARS',
    `В реестре нет активных аватаров. ` +
    (registry._pending?.length ? `В HeyGen обнаружено ${registry._pending.length} новых аватаров — требуется выбор.` : ''));
}

/**
 * Повторить платный запрос после 404 — ONE-Shot auto-recovery.
 * Возвращает новый avatar_id или выбрасывает HeyGenFail.
 */
async function resolve404WithRecovery(oldAvatarId) {
  let registry = loadRegistry();
  if (!registry) registry = initRegistry();

  const heygenAvatars = await fetchHeyGenAvatars();
  applyPreflight(registry, heygenAvatars);

  // Переносим _pending-аватары с status=active в основной список
  if (registry._pending?.length) {
    for (const p of registry._pending) {
      if (p.status === 'active') {
        const entry = makeEntry(p.avatar_id, {
          alias:    `pending-${Date.now()}`,
          name:     p.name,
          type:     p.type || 'digital_twin',
          status:   'active',
        });
        registry.avatars.push(entry);
      }
    }
    registry._pending = [];
  }

  const active = registry.avatars.filter(a => a.status === 'active');

  if (active.length === 1) {
    const replacement = active[0];
    saveRegistry(registry);
    return { avatar_id: replacement.avatar_id, voice_id: replacement.voice_id, fresh: true };
  }

  // Неоднозначно или нет активных — не пытаемся угадать
  saveRegistry(registry);
  throw new HeyGenFail('HEYGEN_AVATAR_NOT_FOUND',
    `Аватар не найден в HeyGen (404). В аккаунте ${active.length} активных аватаров — выбор не однозначен. Рендер отменён, кредиты не потрачены.`);
}

/**
 * Безопасный список аватаров для бота — БЕЗ avatar_id и внутренних данных.
 * Возвращает пронумерованный список + флаг умолчания.
 */
function listAvatarsSafe() {
  const registry = loadRegistry() || initRegistry();
  const choices = registry.avatars.map((a, i) => ({
    number:      i + 1,
    name:        a.name,
    alias:       a.alias,
    status:      a.status,
  }));
  if (registry._pending?.length) {
    for (const p of registry._pending) {
      choices.push({
        number:  choices.length + 1,
        name:    p.name,
        alias:   '(не зарегистрирован)',
        status:  p.status,
      });
    }
  }
  return {
    choices,
    default_number: registry.avatars.findIndex(a => a.alias === registry.default_alias) + 1 || 1,
  };
}

/**
 * Зарегистрировать новый аватар (после create_digital_twin).
 * @param {Object} opts
 */
function registerAvatar({ alias, name, type, avatar_id, voice_id = null, status = 'pending_consent' }) {
  const registry = loadRegistry() || initRegistry();

  // Проверка дубликата alias
  if (registry.avatars.some(a => a.alias === alias)) {
    throw new HeyGenFail('HEYGEN_DUPLICATE_ALIAS', `Алиас «${alias}» уже существует: ${registry.avatars.find(a => a.alias === alias).avatar_id}`);
  }

  const entry = makeEntry(avatar_id, { alias, name, type, status, voice_id });
  registry.avatars.push(entry);

  // Если это первый аватар — делаем его по умолчанию
  if (registry.avatars.length === 1) {
    registry.default_alias = alias;
  }

  registry.updated_at = new Date().toISOString();
  saveRegistry(registry);
  return entry;
}

/**
 * Установить аватар по умолчанию.
 */
function setDefault(alias) {
  const registry = loadRegistry() || initRegistry();
  if (!registry.avatars.some(a => a.alias === alias)) {
    throw new HeyGenFail('HEYGEN_AVATAR_NOT_FOUND', `Алиас «${alias}» не найден в реестре`);
  }
  registry.default_alias = alias;
  registry.updated_at = new Date().toISOString();
  saveRegistry(registry);
}

/**
 * Обновить voice_id у аватара.
 */
function updateVoiceId(alias, voice_id) {
  const registry = loadRegistry();
  if (!registry) return;
  const entry = registry.avatars.find(a => a.alias === alias);
  if (entry) {
    entry.voice_id = voice_id;
    registry.updated_at = new Date().toISOString();
    saveRegistry(registry);
  }
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

async function cli() {
  const [, , cmd, arg] = process.argv;

  try {
    if (cmd === 'list') {
      const reg = loadRegistry() || initRegistry();
      if (reg.avatars.length === 0) {
        console.log('Реестр пуст. Запустите миграцию: node heygen_avatar_registry.js migrate');
        return;
      }
      console.log(`Реестр аватаров HeyGen (default: ${reg.default_alias})`);
      console.log('');
      for (const a of reg.avatars) {
        const marker = a.alias === reg.default_alias ? ' ★' : '';
        console.log(`  [${a.alias}]${marker} "${a.name}" — ${a.status} (${a.type})`);
        console.log(`          avatar_id: ${a.avatar_id}`);
        if (a.voice_id) console.log(`          voice_id:  ${a.voice_id}`);
        console.log(`          проверен:  ${a.last_verified_at}`);
        console.log('');
      }
      if (reg._pending?.length) {
        console.log(`Неизвестные HeyGen-аватары (нужен выбор):`);
        for (const p of reg._pending) {
          console.log(`  "${p.name}" — ${p.status} [${p.avatar_id}]`);
        }
      }
      return;
    }

    if (cmd === 'get') {
      const result = await selectAvatar({ preferAlias: arg || null });
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (cmd === 'set-default') {
      if (!arg) { console.error('Использование: set-default <alias>'); process.exit(1); }
      setDefault(arg);
      console.log(`Аватар «${arg}» установлен по умолчанию`);
      return;
    }

    if (cmd === 'preflight') {
      if (!API_KEY) { console.error('HEYGEN_API_KEY не задан'); process.exit(1); }
      const avatars = await fetchHeyGenAvatars();
      console.log(`HeyGen знает ${avatars.length} аватаров:`);
      for (const a of avatars) console.log(`  [${a.status}] ${a.name} — ${a.avatar_id}`);
      return;
    }

    if (cmd === 'migrate') {
      let registry = loadRegistry();
      const wasEmpty = !registry || registry.avatars.length === 0;
      if (!registry) registry = initRegistry();
      const changed = migrateFromLegacy(registry);
      if (!wasEmpty && changed) {
        console.error('ВНИМАНИЕ: реестр уже существует, миграция обновит записи');
      }
      saveRegistry(registry);
      console.log(`Миграция завершена: ${registry.avatars.length} аватаров в реестре`);
      for (const a of registry.avatars) console.log(`  [${a.alias}] "${a.name}" — ${a.avatar_id}`);
      return;
    }

    // По умолчанию — показать текущий активный аватар
    const result = await selectAvatar();
    console.log(`Активный аватар: "${result.name}" [${result.alias}] = ${result.avatar_id}`);

  } catch (err) {
    if (err instanceof HeyGenFail) {
      console.error(`${err.code}: ${err.message}`);
    } else {
      console.error('Непредвиденная ошибка:', err.message);
    }
    process.exit(1);
  }
}

// ─── Экспорт для generate_avatar_video.js и create_digital_twin.js ────────────

module.exports = {
  HeyGenFail,
  normalizeStatus,
  selectAvatar,
  resolve404WithRecovery,
  listAvatarsSafe,
  registerAvatar,
  updateVoiceId,
  setDefault,
  loadRegistry,
  saveRegistry,
  applyPreflight,
  migrateFromLegacy,
  fetchHeyGenAvatars,
  DEFAULT_ALIAS,
};

// Запуск CLI только при прямом вызове
if (require.main === module) cli();
