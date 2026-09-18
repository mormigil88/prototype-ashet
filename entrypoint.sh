#!/bin/bash
set -e

# === PERSISTENT CONFIG DIR ===
export HOME=/data/claude-home
export CLAUDE_CONFIG_DIR=/data/claude-home

# /data/canva — реестр Canva-ссылок (canva_link.js пишет из-под node; сам /data
# root-owned, поэтому директория создаётся и отдаётся node здесь, до su).
mkdir -p /data/root-dotclaude /data/claude-home /data/memory /data/canva /data/heygen
chown -R node:node /data/root-dotclaude /data/claude-home /data/memory /data/canva /data/heygen
chmod 700 /data/canva /data/heygen
# HOME=/data/claude-home и CLAUDE_CONFIG_DIR=/data/claude-home — симлинк /home/node/.claude не нужен

# Гарантируем админу доступ к боту при каждом старте — access.json плагина
# telegram@claude-plugins-official живёт в $CLAUDE_CONFIG_DIR (persistent volume,
# переживает редеплой), но это ACL, который плагин может сам менять во время
# работы (pairing/allowlist), и он не защищён от того, чтобы админ туда не
# попал вообще (инцидент 2026-08-20: ashet-olga и natashafin оба потеряли админа
# из allowFrom, бот отвечал клиентке "Pairing required" вместо ответа). Не
# трогаем dmPolicy и существующие записи клиента — только добавляем админа,
# если его там ещё нет; сервер плагина обходит dmPolicy для всех, кто есть в
# allowFrom (server.ts: allowFrom.includes(senderId) → deliver, до проверки
# политики), так что это не открывает бота посторонним.
ADMIN_TELEGRAM_CHAT_ID="${ADMIN_TELEGRAM_CHAT_ID:-419465595}"
ACCESS_FILE="$CLAUDE_CONFIG_DIR/channels/telegram/access.json"
mkdir -p "$(dirname "$ACCESS_FILE")"
node -e '
const fs = require("fs");
const [, file, admin] = process.argv;
let data = { dmPolicy: "pairing", allowFrom: [], groups: {}, pending: {} };
if (fs.existsSync(file)) {
  try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) {}
}
data.allowFrom = data.allowFrom || [];
if (!data.allowFrom.includes(admin)) data.allowFrom.push(admin);
fs.writeFileSync(file, JSON.stringify(data, null, 2));
' "$ACCESS_FILE" "$ADMIN_TELEGRAM_CHAT_ID"
chown node:node "$ACCESS_FILE"
chmod 600 "$ACCESS_FILE"

# Аварийный посев/пересев OAuth-сессии — на случай, если сессия текущего
# владельца подписки истечёт ("Not logged in", см. companion.js/detectAuthExpired
# и capability_claude_code_channels_deploy.md). Обычно не используется при первом
# деплое клиента (у внешнего клиента логин делается им самим через Railway
# Console) — но тот же механизм пригождается для восстановления БЕЗ похода в
# Console, если у нас на руках есть валидный токен владельца (Keychain на его
# машине). SEED_CLAUDE_CREDENTIALS/FORCE_RESEED выставляются вручную и
# удаляются с Railway сразу после подтверждённого успешного старта — токен не
# должен жить в env дольше необходимого. Guard пуст, если переменных нет —
# ничего не делает, безопасно для всех клиентов по умолчанию.
if [ -n "$SEED_CLAUDE_CREDENTIALS" ] && { [ ! -f /data/claude-home/.credentials.json ] || [ -n "$FORCE_RESEED" ]; }; then
  printf '%s' "$SEED_CLAUDE_CREDENTIALS" > /data/claude-home/.credentials.json
  chmod 600 /data/claude-home/.credentials.json
  chown node:node /data/claude-home/.credentials.json
fi

# CLAUDE.md пересобирается на каждом старте из CLAUDE.base.md (исходный системный
# промпт, зашит в образ) — иначе память с прошлых сессий, дописываемая ниже,
# накапливалась бы в файле бесконечно при каждом передеплое.
cp /app/CLAUDE.base.md /app/CLAUDE.md

# Уровни 2-3 памяти (episodic+semantic) с neurostaff — грузим ДО первого ответа
# Ашета, чтобы Claude получил контекст системным промптом, а не полагался на то,
# что сам вызовет /recall по инструкции в CLAUDE.md (ненадёжно — необязательный
# шаг на уровне рантайма, модель может его пропустить). Не роняет контейнер при
# недоступном гейте — см. recall_memory.js.
node /app/recall_memory.js
chown node:node /app/CLAUDE.md

# Компаньон-процесс — usage-эндпоинт + пост-хок детектор порчи текста для дирижёра.
# Отдельный процесс, не мешает claude (не трогает его stdin/stdout/pty).
su -p node -c 'node /app/companion.js' &

# Продолжаем последнюю сессию, если:
# - есть JSONL-транскрипт в /data/claude-home/projects/-app/
# - И переменная PROMPT_VERSION НЕ изменилась (иначе старый контекст сессии противоречит новому промпту)
CLAUDE_CMD="claude --ax-screen-reader --channels plugin:telegram@claude-plugins-official --dangerously-skip-permissions"
PREV_SUMMARY_FILE="/data/claude-home/.prompt-version"
SESSION_JSONL_COUNT=$(compgen -G "/data/claude-home/projects/-app/*.jsonl" 2>/dev/null | wc -l)

if [ "$SESSION_JSONL_COUNT" -gt 0 ]; then
  if [ -f "$PREV_SUMMARY_FILE" ] && [ "$(cat "$PREV_SUMMARY_FILE" 2>/dev/null)" = "${PROMPT_VERSION:-default}" ]; then
    CLAUDE_CMD="$CLAUDE_CMD --continue"
    echo "[entrypoint] предыдущая сессия найдена + PROMPT_VERSION совпадает — продолжаем (--continue)"
  else
    echo "[entrypoint] PROMPT_VERSION изменилась или первый запуск — новая сессия (игнорируем старые jsonl)"
  fi
else
  echo "[entrypoint] предыдущих сессий не найдено — новая сессия"
fi

# Сохраняем текущую PROMPT_VERSION для следующего старта
mkdir -p /data/claude-home
echo "${PROMPT_VERSION:-default}" > "$PREV_SUMMARY_FILE"

# CLAUDE_CONFIG_DIR теперь выставлен выше; Claude найдёт .claude.json с hasCompletedOnboarding:true.
# Startup-логи — видны в railway logs
echo "[entrypoint] config ready"
echo "[entrypoint] prompt version ${PROMPT_VERSION:-default} fresh session"
echo "[entrypoint] channels starting"

exec env HOME=/data/claude-home su -p node -c "script -qec \"$CLAUDE_CMD\" /data/claude-home/claude-stdout.log"
