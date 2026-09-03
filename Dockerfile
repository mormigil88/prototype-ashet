FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl unzip ca-certificates git python3 python3-pip \
    imagemagick fontconfig fonts-dejavu-core \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Локальная сегментация создаёт маску человека: после Runway оригинальные
# пиксели лица и тела накладываются обратно, а не перерисовываются моделью.
ENV U2NET_HOME="/opt/rembg-models"
ENV NUMBA_DISABLE_JIT="1"
RUN python3 -m pip install --no-cache-dir --break-system-packages "rembg[cpu]==2.0.67" \
    && python3 -c "from rembg import new_session; new_session('u2net_human_seg')" \
    && chown -R node:node /opt/rembg-models

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
COPY segment_person.py /app/segment_person.py
COPY preserve_person.py /app/preserve_person.py
COPY segment_face.py /app/segment_face.py
COPY preserve_face.py /app/preserve_face.py
COPY edit_image_runway.js /app/edit_image_runway.js
COPY generate_image.js /app/generate_image.js
COPY generate_video.js /app/generate_video.js
COPY compose_video.js /app/compose_video.js
COPY add_video_text.js /app/add_video_text.js
COPY burn_word_subtitles.js /app/burn_word_subtitles.js
COPY generate_avatar_video.js /app/generate_avatar_video.js
COPY clone_voice.js /app/clone_voice.js
COPY create_avatar.js /app/create_avatar.js
COPY prepare_youtube_avatar_source.js /app/prepare_youtube_avatar_source.js
COPY create_digital_twin.js /app/create_digital_twin.js
COPY publish_request.js /app/publish_request.js
COPY recall_memory.js /app/recall_memory.js
RUN chown -R node:node /app

# Нужен в рантайме, чтобы подготовить собственный ролик Иры с YouTube для
# обучения HeyGen Digital Twin (после явного подтверждения прав и согласия).
RUN curl -L --fail --retry 3 \
    https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    -o /usr/local/bin/yt-dlp && chmod 755 /usr/local/bin/yt-dlp

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
