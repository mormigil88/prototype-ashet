#!/bin/bash
# Провижинер для нового Channels-клиента NeuroStaff (вариант A из плана автоматизации,
# см. память project_ashet_channels_bots.md — при 3-м платном клиенте пересмотреть на вариант B).
#
# ПЕРВЫЙ РАЗ ЗДЕСЬ? Читай CHANNELS_CLIENT_PLAYBOOK.md рядом с этим скриптом — там весь
# стандарт зрелости, архитектура памяти и известные баги одним файлом, без раскопок истории.
#
# Использование:
#   ./new_channels_client.sh <client-slug> <telegram-bot-token>
#
# Перед запуском:
#   1. Создать бота через @BotFather, получить токен
#   2. Положить готовый системный промпт клиента в CLAUDE.md рядом с этим скриптом
#      (или в <client-slug>/CLAUDE.md — скрипт подскажет)
#
# Что делает сам: создаёт папку проекта, копирует проверенный Dockerfile/entrypoint.sh/
# companion.js/transcribe.js/recall_memory.js/edit_image.js/generate_image.js/
# generate_video.js/compose_video.js/generate_avatar_video.js, git-репозиторий
# (откат версий), Railway-проект+сервис, публичный домен для companion.js
# (usage + детектор порчи текста), деплоит.
#
# generate_avatar_video.js (клонированный голос + видео-аватар — всё через HeyGen,
# один вендор, решение от 22.07.2026) копируется как часть шаблона, чтобы не
# повторить баг 16.07.2026 (скрипт отставал от Dockerfile) — но РАБОТАЕТ только
# когда на сервисе заданы HEYGEN_API_KEY/HEYGEN_AVATAR_ID_<SLUG>/
# HEYGEN_VOICE_ID_<SLUG> (см. clone_voice.js/create_avatar.js — разовая настройка
# per-client, НЕ автоматизирована этим скриптом, запускать вручную при необходимости).
#
# Обычно этот скрипт не вызывается напрямую — им пользуется Skill "new-channels-client"
# (~/.claude/skills/new-channels-client/), который сначала проводит короткое интервью про
# нового клиента и пишет CLAUDE.md, а потом запускает этот скрипт. Прямой запуск руками
# по-прежнему работает — Skill просто избавляет от необходимости держать в голове весь
# стандарт зрелости ниже.
#
# Стандарт зрелости (обязателен для КАЖДОГО Channels-клиента, не опционально —
# закрывает 6 дыр, найденные и исправленные на Ашет, см. память
# capability_claude_code_channels_deploy.md § Стандарт зрелости):
#   1. Git — откат версий CLAUDE.md/Dockerfile
#   2. companion.js — прозрачность токенов + пост-хок детектор порчи текста
#   3. Дирижёр (super_bot.py на neurostaff) опрашивает companion.js и следит за живостью —
#      это НЕ делает этот скрипт, нужно руками добавить клиента в super_bot.py
#      (см. ASHET_TG_BOT_TOKEN/ASHET_COMPANION_URL как образец, обобщить под N клиентов
#      стоит сделать при 2-3-м клиенте, не раньше — сейчас copy-paste дешевле абстракции)
#   4. Approval-gateway — публикация ТОЛЬКО через жёсткий гейт (publish_gateway.py на
#      neurostaff), никогда не давать клиенту реальный ключ соцсети напрямую. Решает
#      САМ КЛИЕНТ по одноразовой ссылке в своём чате (не inline-кнопка — его бот уже занят
#      getUpdates-поллингом внутри Channels-агента, второй консьюмер апдейтов сломает оба,
#      см. capability_claude_code_channels_deploy.md) — админ остаётся резервным override
#      через Telegram-кнопки, не единственный путь. Инструкция с curl-процедурой уже должна
#      быть в CLAUDE.md клиента (скопируй раздел "Как публиковать" из ashet-olga/CLAUDE.md,
#      поменяй client_slug). Платформы: instagram (Buffer), telegram_channel (обычный пост
#      в канал, где бот админ), telegram_story_personal/telegram_story_channel (см. пункт 7).
#   5. transcribe.js — распознавание голосовых И ВИДЕО через Groq Whisper (бесплатный
#      тариф, video-контейнеры типа mp4 транскрибирует без доп. кода — Whisper сам вытаскивает
#      звук). Channels/Telegram-плагин сам не расшифровывает медиа. Скопируй технический шаг
#      из раздела "Как обрабатывать её голосовые и видео" в ashet-olga/CLAUDE.md, нужен
#      GROQ_API_KEY. Файлы >20МБ Bot API вообще не скачает (см. пункт 8, известное ограничение,
#      ещё не автоматизировано в этом скрипте).
#   6. Memory-gateway — уровни 2-3 памяти (episodic+semantic) ТОЛЬКО через memory_gateway.py
#      на neurostaff, в отдельной БД channels_memory, не в платформенной. Клиент никогда не
#      получает креды БД, только URL+секрет. Инструкция — раздел "Память между сессиями"
#      в ashet-olga/CLAUDE.md (скопируй, поменяй client_slug).
#   7. Telegram-канал/Stories (опционально, если у клиента есть свой TG-канал) — обычные
#      посты идут через Bot API напрямую (telegram_channel_publish.py, дёшево, без сессии).
#      Stories (личный аккаунт ИЛИ канал) технически не существуют в Bot API вообще — только
#      MTProto от лица живого юзер-аккаунта (Telethon), т.е. по чувствительности как хранить
#      пароль от личного Telegram клиента. Делать только по явному запросу клиента, не
#      навязывать. См. пункт 8 ниже.
#
# Что НЕ делает (осознанно, по причинам ниже) — печатает точные инструкции в конце:
#   - Volume (railway volume add падает багом CLI на любых флагах, проверено на 5.15.0 и 5.26.0
#     — воспроизводимо, не наша ошибка в командах). Обход только через веб-дашборд, 30 секунд.
#   - Логин клиента в его Claude Pro/Max (OAuth) — обязан делать сам клиент, это не автоматизируется
#   - Пейринг Telegram-аккаунта клиента — тоже обязан делать сам клиент (доказывает владение аккаунтом)
#   - Регистрация клиента в дирижёре (super_bot.py) — руками, см. пункт 3 выше
#   - PUBLISH_GATEWAY_SECRET_<SLUG> на neurostaff — значение генерируется уникально для
#     клиента и сохраняется в его локальном .env; на neurostaff его нужно поставить руками,
#     потому что текущий Railway-контекст скрипта уже переключён на проект клиента.
#   - MEMORY_GATEWAY_SECRET_<SLUG> на neurostaff — также уникален для клиента, чтобы
#     подмена client_slug не открывала память другого клиента.

set -e

CLIENT_SLUG="$1"
BOT_TOKEN="$2"
TEMPLATE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECTS_ROOT="/Users/andrejorlov/Documents/my-project"
CLIENT_DIR="$PROJECTS_ROOT/$CLIENT_SLUG"

if [ -z "$CLIENT_SLUG" ] || [ -z "$BOT_TOKEN" ]; then
  echo "Использование: $0 <client-slug> <telegram-bot-token>"
  echo "Пример: $0 ashet-ivanov 123456789:AAF..."
  exit 1
fi

echo "== 1/7: Папка проекта =="
mkdir -p "$CLIENT_DIR"
cp "$TEMPLATE_DIR/Dockerfile" "$CLIENT_DIR/Dockerfile"
cp "$TEMPLATE_DIR/entrypoint.sh" "$CLIENT_DIR/entrypoint.sh"
cp "$TEMPLATE_DIR/companion.js" "$CLIENT_DIR/companion.js"
cp "$TEMPLATE_DIR/transcribe.js" "$CLIENT_DIR/transcribe.js"
cp "$TEMPLATE_DIR/recall_memory.js" "$CLIENT_DIR/recall_memory.js"
cp "$TEMPLATE_DIR/edit_image.js" "$CLIENT_DIR/edit_image.js"
cp "$TEMPLATE_DIR/generate_image.js" "$CLIENT_DIR/generate_image.js"
cp "$TEMPLATE_DIR/generate_video.js" "$CLIENT_DIR/generate_video.js"
cp "$TEMPLATE_DIR/compose_video.js" "$CLIENT_DIR/compose_video.js"
cp "$TEMPLATE_DIR/generate_avatar_video.js" "$CLIENT_DIR/generate_avatar_video.js"

if [ ! -f "$CLIENT_DIR/CLAUDE.md" ]; then
  echo "⚠️  $CLIENT_DIR/CLAUDE.md не найден."
  echo "   Собери системный промпт клиента (характер/позиционирование/правила) и положи туда."
  echo "   ОБЯЗАТЕЛЬНО скопируй раздел 'Как публиковать, когда доступы появятся' из"
  echo "   ashet-olga/CLAUDE.md (замени client_slug на '$CLIENT_SLUG') — это жёсткий гейт,"
  echo "   не промпт-просьба, без него клиент технически способен опубликовать без согласования."
  echo "   ЗАТЕМ перезапусти скрипт — без CLAUDE.md деплоить нет смысла."
  exit 1
fi

echo "TELEGRAM_BOT_TOKEN=$BOT_TOKEN" > "$CLIENT_DIR/.env"
cat > "$CLIENT_DIR/.gitignore" <<'EOF'
.env
EOF

echo "== 1.5/7: Git (откат версий CLAUDE.md/Dockerfile — без этого правки нечем откатывать) =="
git -C "$CLIENT_DIR" init -q
git -C "$CLIENT_DIR" add Dockerfile entrypoint.sh CLAUDE.md companion.js transcribe.js recall_memory.js edit_image.js generate_image.js generate_video.js compose_video.js generate_avatar_video.js .gitignore
git -C "$CLIENT_DIR" commit -q -m "Начальная версия $CLIENT_SLUG"

echo "== 2/7: Railway-проект =="
cd "$CLIENT_DIR"
railway init --name "$CLIENT_SLUG" --json

echo "== 3/7: Сервис =="
railway add --service "$CLIENT_SLUG" --json

echo "== 4/7: Переменные окружения =="
COMPANION_SECRET_NEW=$(openssl rand -hex 24)
PUBLISH_GATEWAY_SECRET_NEW=$(openssl rand -hex 32)
MEMORY_GATEWAY_SECRET_NEW=$(openssl rand -hex 32)
printf '\nPUBLISH_GATEWAY_SECRET=%s\nMEMORY_GATEWAY_SECRET=%s\n' \
  "$PUBLISH_GATEWAY_SECRET_NEW" "$MEMORY_GATEWAY_SECRET_NEW" >> "$CLIENT_DIR/.env"
railway variable --service "$CLIENT_SLUG" --set "TELEGRAM_BOT_TOKEN=$BOT_TOKEN"
railway variable --service "$CLIENT_SLUG" --set "COMPANION_SECRET=$COMPANION_SECRET_NEW"
railway variable --service "$CLIENT_SLUG" --set "PUBLISH_GATEWAY_SECRET=$PUBLISH_GATEWAY_SECRET_NEW"
railway variable --service "$CLIENT_SLUG" --set "MEMORY_GATEWAY_SECRET=$MEMORY_GATEWAY_SECRET_NEW"
echo "⚠️  GROQ_API_KEY для распознавания голосовых (transcribe.js) — не сгенерирован автоматом:"
echo "   railway variables --kv --service neurostaff | grep GROQ_API_KEY"
echo "   railway variable --service $CLIENT_SLUG --set \"GROQ_API_KEY=<значение>\""

echo "== 5/7: Деплой (Dockerfile + entrypoint.sh уже проверены на ashet-olga) =="
railway up --service "$CLIENT_SLUG" --ci

echo "== 6/7: Публичный домен для companion.js (usage + детектор порчи текста) =="
railway domain --service "$CLIENT_SLUG"
echo "⚠️  Порт не выставлен автоматически — сделай руками:"
echo "   railway domain update <сгенерированный-домен> --port 8787 --service $CLIENT_SLUG"

echo "== 7/7: Готово — но нужны ещё ручные шаги =="
cat <<EOF

────────────────────────────────────────────────────────────
Дальше руками (~20 минут, из них Buffer/бизнес-аккаунт клиента — по его времени, не твоему):

1) VOLUME (баг CLI, обход через дашборд):
   Открой https://railway.com → проект "$CLIENT_SLUG" → канвас →
   кнопка "Add" → "Volume" → сервис "$CLIENT_SLUG" уже выбран →
   mount path: /data → "Deploy" (применить staged change)

2) ЛОГИН КЛИЕНТА + ПЕЙРИНГ TELEGRAM:
   Открой Settings сервиса "$CLIENT_SLUG" → вкладка Console (реальный pty в браузере).
   Выполни:
     env HOME=/home/node su -p node -c 'claude --dangerously-skip-permissions'
   → пришли клиенту OAuth-ссылку из вывода, дождись кода, вставь его в терминал
   → прими экран "Bypass Permissions mode" (пункт 2 "Yes, I accept")
   → /plugin install telegram@claude-plugins-official
   → /reload-plugins
   → попроси клиента написать что-нибудь боту → он пришлёт код пейринга
   → /telegram:access pair <код>
   → /telegram:access policy allowlist
   → /exit

   После этого контейнер сам поднимется по ENTRYPOINT при следующем деплое/рестарте —
   ничего больше руками не нужно, все настройки на persistent volume.

   Админский chat_id (по умолчанию 419465595, Андрей) entrypoint.sh сам добавляет
   в allowFrom при каждом старте контейнера — вручную пейрить админа не нужно,
   он получает доступ к боту клиента автоматически с первого деплоя. Если для
   этого клиента нужен другой админ — задай ADMIN_TELEGRAM_CHAT_ID в переменных
   сервиса на Railway.

3) ДИРИЖЁР (super_bot.py на neurostaff) — добавь клиента в мониторинг:
   По образцу ASHET_TG_BOT_TOKEN/ASHET_COMPANION_URL/_ashet_health_job/_ashet_quality_job —
   добавь такие же переменные+job для "$CLIENT_SLUG" (или обобщи на список клиентов,
   если это уже 3-й+ Channels-клиент — не раньше, см. project_ashet_channels_bots.md).
   ОБЯЗАТЕЛЬНО внутри нового _<slug>_quality_job вызови общий
   `await _check_channels_auth_expired(context, "$CLIENT_SLUG", "<имя клиента>", status)`
   сразу после проверки status.get("ok") — это единый детектор истёкшей OAuth-сессии
   ("Not logged in", найдено 16.07.2026 на Амине), НЕ пиши его заново per-client, он уже
   умеет алертить админа с точной инструкцией, что переключить на Railway.

4) PUBLISH_GATEWAY_SECRET — уникальный для этого клиента, чтобы один Channels-агент
   технически не мог создавать заявки от имени другого. Значение уже сохранено скриптом
   в $CLIENT_DIR/.env и выставлено на сервисе клиента. В Railway-проекте neurostaff задай
   то же значение под именем, привязанным к slug:
     railway variable --service neurostaff --set "PUBLISH_GATEWAY_SECRET_<SLUG>=<значение из $CLIENT_DIR/.env>"
   Затем на сервисе клиента задай URL гейта:
     railway variable --service "$CLIENT_SLUG" --set "PUBLISH_GATEWAY_URL=https://neurostaff-production.up.railway.app/publish-request"
     railway variable --service "$CLIENT_SLUG" --set "PUBLISH_GATEWAY_URL_UPLOAD=https://neurostaff-production.up.railway.app/upload-media"
   <SLUG> = client_slug в верхнем регистре, дефисы → подчёркивания.

4.5) CLIENT-APPROVAL (обязательно, иначе решение падает только на резервный override
   админа) — гейт шлёт клиенту одноразовую ссылку согласования его же ботом, значит на
   **neurostaff** (не на клиенте!) нужны его токен и chat_id:
     railway variable --service neurostaff --set "TELEGRAM_BOT_TOKEN_<SLUG>=$BOT_TOKEN"
   chat_id клиента узнать просто — спроси его самого в чате с ботом "какой у этого чата
   chat_id" (Channels-агент видит это в теге входящего сообщения, может просто ответить
   числом), затем:
     railway variable --service neurostaff --set "CLIENT_CHAT_ID_<SLUG>=<число>"
   <SLUG> = client_slug в верхнем регистре, дефисы → подчёркивания (ashet-olga → ASHET_OLGA).
   Тот же TELEGRAM_BOT_TOKEN_<SLUG> переиспользуется в пункте 6 (посты в канал) — не дублировать.

5) BUFFER — публикация в Instagram (пост/сторис/рилс) реально происходит через Buffer,
   не Meta Graph API напрямую (не требует нашей верификации разработчика в Meta,
   Buffer уже прошёл App Review сам — см. capability_claude_code_channels_deploy.md).
   Каждый клиент — свой Buffer-аккаунт (не шарить один на всех):
   a) Клиент переводит свой Instagram в Professional (Business/Creator) и привязывает
      страницу Facebook — ЭТО ДЕЛАЕТ ТОЛЬКО САМ КЛИЕНТ, не автоматизируется
   b) Завести Buffer-аккаунт для клиента (buffer.com, бесплатный тариф хватает — 1 канал)
      → подключить его Instagram через OAuth в интерфейсе Buffer
   c) Взять токен: publish.buffer.com/settings/api
   d) Взять channelId: GraphQL-запрос channels(organizationId: "...") через Buffer API
   e) Прописать на **neurostaff** (не на клиенте — публикация выполняется там, в
      handle_publish_request_callback):
        railway variable --service neurostaff --set "BUFFER_ACCESS_TOKEN_<SLUG>=<токен>"
        railway variable --service neurostaff --set "BUFFER_CHANNEL_ID_<SLUG>=<channelId>"
      где <SLUG> = client_slug в верхнем регистре, дефисы → подчёркивания
      (ashet-olga → ASHET_OLGA). См. buffer_publish.py.
   Без этого шага approve-кнопка в Telegram фиксирует решение в БД, но публиковать
   физически нечем — гейт честно об этом скажет, не притворяется, что опубликовал.

6) MEMORY_GATEWAY_SECRET — также уникальный для клиента: это не позволяет одному агенту
   подменить client_slug и прочитать/изменить память другого. Значение уже сохранено в
   $CLIENT_DIR/.env и выставлено на клиентском сервисе. На **neurostaff** задай:
     railway variable --service neurostaff --set "MEMORY_GATEWAY_SECRET_<SLUG>=<значение из $CLIENT_DIR/.env>"
   Затем на клиентском сервисе задай URL:
     railway variable --service "$CLIENT_SLUG" --set "MEMORY_GATEWAY_URL_RECALL=https://neurostaff-production.up.railway.app/recall"
     railway variable --service "$CLIENT_SLUG" --set "MEMORY_GATEWAY_URL_REMEMBER=https://neurostaff-production.up.railway.app/remember"
   Скопируй раздел "Память между сессиями" из ashet-olga/CLAUDE.md в CLAUDE.md нового клиента,
   поменяй только client_slug в теле curl-запросов.

6.5) KB_SEARCH — база знаний по Reels/офферам (курс + книги Хормози), обязательный
   базовый скилл для КАЖДОГО SMM-типа Channels-клиента (19.07.2026: прямая позиция
   Андрея — все SMM-агенты стартуют с одинаковым базовым набором скиллов; изолировать
   нужно личную память/переписку клиента, НЕ общий контент курса — см.
   feedback_smm_agent_base_skillset.md). В отличие от MEMORY_GATEWAY_SECRET — секрет
   ОДИН общий на всех клиентов, не per-client (контент не приватен ни одному из них):
     railway variable --service "$CLIENT_SLUG" --set "KB_SEARCH_SECRET=<то же значение, что на neurostaff>"
     railway variable --service "$CLIENT_SLUG" --set "KB_SEARCH_URL=https://neurostaff-production.up.railway.app/kb-search"
   Значение KB_SEARCH_SECRET взять с neurostaff: railway variables --kv --service neurostaff | grep KB_SEARCH_SECRET
   Скопируй раздел "База знаний по Reels и офферам" из ashet-olga/CLAUDE.md в CLAUDE.md
   нового клиента без изменений (эндпоинт общий, per-client ничего менять не нужно).
   Если контент/тон клиента сильно отличается — можно позже стилизовать (добавить
   client_slug-специфичные фрагменты через отдельный agent_id), но НЕ на старте: сначала
   общая база у всех, кастомизация — по необходимости (см. ту же память выше).

7) TELEGRAM-КАНАЛ (опционально, если у клиента есть свой TG-канал и бот там уже админ) —
   обычные посты, простой Bot API, без Buffer и без сессии. Токен уже есть из пункта 4.5,
   нужен только chat_id/@username канала:
     railway variable --service neurostaff --set "TELEGRAM_CHANNEL_ID_<SLUG>=<chat_id или @username>"
   См. telegram_channel_publish.py. В CLAUDE.md клиента: platform "telegram_channel".

8) TELEGRAM STORIES (опционально, ТОЛЬКО по явному запросу клиента — читай предупреждение
   в пункте 7 стандарта зрелости выше про чувствительность). Bot API не умеет Stories вообще —
   нужна MTProto-сессия клиента (Telethon):
   a) TG_API_ID/TG_API_HASH — можно переиспользовать уже существующие на neurostaff
      (одно приложение my.telegram.org обслуживает сколько угодно разных клиентских сессий),
      либо завести отдельные под конкретного клиента на my.telegram.org/apps, если нужна
      изоляция:
        railway variables --kv --service neurostaff | grep -E "^TG_API_ID=|^TG_API_HASH="
   b) Логин клиента (двухшаговый, без нужды в живом терминале клиента — код передаётся
      через тебя в чате, telegram_story_login_step1.py/_step2.py в папке neurostaff/):
        TG_API_ID=... TG_API_HASH=... python3 telegram_story_login_step1.py <slug> <телефон>
      → клиент присылает код из SMS/Telegram →
        TG_API_ID=... TG_API_HASH=... python3 telegram_story_login_step2.py <slug> <телефон> <код> <phone_code_hash-из-шага-1> [2FA-пароль]
      → в выводе SESSION_STRING= — сохрани сразу:
        railway variable --service neurostaff --set "TELETHON_SESSION_<SLUG>=<строка>"
      Временный /tmp/telethon_login_<slug>.session удали сразу после — сессия теперь только
      в переменной окружения (StringSession, не файл — переживает редеплой без volume).
   c) См. telegram_story_publish.py. В CLAUDE.md клиента: platform "telegram_story_personal"
      (личный аккаунт) или "telegram_story_channel" (нужен ещё пункт 7 выше для channel_id).
      stories.SendStoryRequest — относительно новый TL-метод, на первом реальном вызове у
      нового клиента возможны сюрпризы формата media/privacy_rules, не только копипаста.

ИЗВЕСТНОЕ НЕ РЕШЕНО (см. project_ashet_channels_bots.md): файлы >20МБ (видео) Bot API вообще
не даёт скачать download_attachment — нужен отдельный релей через Telethon-сессию клиента
(higher upload limit) + ffmpeg в Dockerfile для вырезания звука перед Whisper. Не в этом
скрипте пока, руками при следующей необходимости.

Полный технический разбор багов/фиксов — в памяти capability_claude_code_channels_deploy.md
────────────────────────────────────────────────────────────
EOF
