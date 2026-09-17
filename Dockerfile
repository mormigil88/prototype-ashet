# syntax=docker/dockerfile:1
FROM node:20-bookworm-slim

# ─── System dependencies ──────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl unzip ca-certificates git \
    imagemagick fontconfig fonts-dejavu-core \
    ffmpeg \
    tesseract-ocr tesseract-ocr-rus \
    poppler-utils \
    libjpeg62-turbo \
    python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*

# TESSDATA_PREFIX for tesseract-ocr (Debian path)
ENV TESSDATA_PREFIX="/usr/share/tesseract-ocr/5/tessdata"

# Python venv for PIL/Pillow + playwright
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
ENV VIRTUAL_ENV="/opt/venv"

# Install Python packages AFTER venv is ready
RUN /opt/venv/bin/pip install --no-cache-dir \
    Pillow pytesseract playwright

# Install Playwright Chromium browser
RUN /opt/venv/bin/playwright install chromium --with-deps

# Bun — нужен плагинам-каналам (Telegram/Discord — это Bun-скрипты)
ENV BUN_INSTALL="/opt/bun"
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="$BUN_INSTALL/bin:$PATH"

# Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# APP_DIR is the canonical location for all pipeline scripts
ENV APP_DIR="/app"

# ─── Pipeline files (Design by Reference) ─────────────────────────────────
COPY preflight.py /app/preflight.py
COPY design-analyzer.js /app/design-analyzer.js
COPY vision-provider.js /app/vision-provider.js
COPY multi-ref.js /app/multi-ref.js
COPY schema-validator.js /app/schema-validator.js
COPY editorial-renderer.js /app/editorial-renderer.js
COPY content-auditor.js /app/content-auditor.js
COPY design-by-reference-preview.js /app/design-by-reference-preview.js
COPY design-spec.schema.json /app/design-spec.schema.json
COPY components/ /app/components/

# ─── Node dependencies ──────────────────────────────────────────────────────
WORKDIR /app
RUN npm install --no-save @aws-sdk/client-s3@3.1120.0

# ─── App files ────────────────────────────────────────────────────────────
COPY companion.js /app/companion.js
COPY claude_auth_recovery.js /app/claude_auth_recovery.js
COPY transcribe.js /app/transcribe.js
COPY edit_image.js /app/edit_image.js
COPY publish_request.js /app/publish_request.js
COPY canva_render.js /app/canva_render.js
COPY canva_link.js /app/canva_link.js
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
COPY subtitle_helpers.js /app/subtitle_helpers.js
COPY burn_translated_subtitles.js /app/burn_translated_subtitles.js
COPY prepare_translated_subtitles.js /app/prepare_translated_subtitles.js
COPY generate_avatar_video.js /app/generate_avatar_video.js
COPY media_archive.js /app/media_archive.js
COPY clone_voice.js /app/clone_voice.js
COPY create_avatar.js /app/create_avatar.js
COPY prepare_youtube_avatar_source.js /app/prepare_youtube_avatar_source.js
COPY create_digital_twin.js /app/create_digital_twin.js
COPY heygen_avatar_registry.js /app/heygen_avatar_registry.js
COPY recall_memory.js /app/recall_memory.js

# CLAUDE.base.md — исходный системный промпт, entrypoint.sh копирует его в CLAUDE.md на каждом старте
COPY CLAUDE.md /app/CLAUDE.base.md

RUN chown -R node:node /app

# ─── yt-dlp (YouTube video download) ──────────────────────────────────────
RUN curl -L --fail --retry 3 \
    https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    -o /usr/local/bin/yt-dlp && chmod 755 /usr/local/bin/yt-dlp

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
