FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl unzip ca-certificates git \
    imagemagick fontconfig fonts-dejavu-core \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Bun — нужен плагинам-каналам (Telegram/Discord — это Bun-скрипты)
# Ставим в /opt, а не в $HOME=/root — непривилегированный appuser не может
# зайти в /root (нужен для --dangerously-skip-permissions, который Claude
# Code запрещает запускать от root)
ENV BUN_INSTALL="/opt/bun"
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="$BUN_INSTALL/bin:$PATH"

# Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Постоянное хранилище авторизации/конфига Claude Code монтируется в /data (volume)
ENV CLAUDE_CONFIG_DIR="/data/claude-home"

# Отключаем интерактивный промпт "Resume from summary?" — в headless-контейнере
# его некому подтвердить (нет TTY), и claude --continue вешает весь процесс
# намертво, как только сессия на volume проживёт дольше 70 мин простоя ИЛИ
# наберёт 100k токенов (дефолты CLI). Инцидент 16.07.2026 у ashet-olga: бот не
# отвечал клиенту 12+ часов, дирижёр не мог это увидеть (сообщение застревает
# ДО записи в транскрипт). Пороги подняты фактически до бесконечности — промпт
# просто никогда не должен всплывать в этом сценарии использования.
ENV CLAUDE_CODE_RESUME_THRESHOLD_MINUTES="999999999"
ENV CLAUDE_CODE_RESUME_TOKEN_THRESHOLD="999999999"

# Непривилегированный пользователь — обязателен для --dangerously-skip-permissions.
# node:bookworm-slim уже включает пользователя "node" (uid 1000), используем его.

WORKDIR /app
# CLAUDE.base.md — исходный системный промпт, entrypoint.sh копирует его в
# CLAUDE.md на каждом старте, до дописывания памяти прошлых сессий.
COPY CLAUDE.md /app/CLAUDE.base.md
COPY companion.js /app/companion.js
COPY transcribe.js /app/transcribe.js
COPY edit_image.js /app/edit_image.js
COPY generate_image.js /app/generate_image.js
COPY generate_video.js /app/generate_video.js
COPY compose_video.js /app/compose_video.js
COPY generate_avatar_video.js /app/generate_avatar_video.js
COPY recall_memory.js /app/recall_memory.js
RUN chown -R node:node /app

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
