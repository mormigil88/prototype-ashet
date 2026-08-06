#!/bin/bash
set -e

mkdir -p /data/root-dotclaude /data/claude-home /data/memory
chown -R node:node /data/root-dotclaude /data/claude-home /data/memory
ln -sfn /data/root-dotclaude /home/node/.claude
chown -h node:node /home/node/.claude

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

# Продолжаем последнюю сессию, если на persistent volume уже есть JSONL-транскрипт —
# иначе каждый редеплой начинал новую сессию Claude Code и короткий разговор
# (2-7 реплик, обычный для Ольги) терялся, даже если факты/summary выше уже
# подгружены. Первый запуск/новый volume — без --continue (сессий ещё нет).
CLAUDE_CMD="claude --channels plugin:telegram@claude-plugins-official --dangerously-skip-permissions"
if compgen -G "/data/claude-home/projects/-app/*.jsonl" > /dev/null 2>&1; then
  CLAUDE_CMD="$CLAUDE_CMD --continue"
  echo "[entrypoint] найдена предыдущая сессия — продолжаем (--continue)"
else
  echo "[entrypoint] предыдущих сессий не найдено — новая сессия"
fi

exec env HOME=/home/node su -p node -c "script -qec \"$CLAUDE_CMD\" /dev/null"
