# Промт для следующей сессии по Бот №2 + Buffer-интеграция — 15.08.2026+

Копируй от `——— START ———` до `——— END ———` в новый чат с Claude Code.
Это **третья сессия** после деплоя Бот №1 и пивота на Tailscale.

——— START ———

Продолжаем работу с первым клиентом по модели Channels-as-a-Service.
Проект `prototype-ashet` (= Бот №2, генерация контента) уже развёрнут
в Railway-аккаунте Иры Крец. Бот живой, идёт сессия с Ирой по
онбордингу. Бот №1 (`prototype-ashet-publisher`) задеплоен 15.08.2026,
ждёт OAuth-логина Иры и подключения Buffer-аккаунта.

## Что сделано в прошлой сессии (15.08.2026 ~03:00–06:40 UTC)

✅ Бот №1 (публикация) развёрнут в Railway-аккаунте Иры:
- `prototype-ashet-publisher-production.up.railway.app`
- `companion.js` отвечает 200 OK на `/status` с `x-companion-secret`
- 12 ENV переменных поставлены, 3 секрета ротированы после инцидента
- Per-client секреты дублированы на neurostaff

✅ Remote access пивот с RustDesk на Tailscale (Railway TCP платный):
- Tailscale CLI 1.102.2 + `tailscaled` в userspace работают на моём маке
- Auth-ссылка передана Андрею: https://login.tailscale.com/a/eaa48ff010cce
- RustDesk hbbs/hbbr сервисы на Railway Иры остались (Developer не может delete)

✅ Memory обновлены:
- `prototype-ashet-publisher-deployed-2026-08-15.md` — статус Бот №1
- `irina-remote-access-tailscale-2026-08-15.md` — пивот на Tailscale
- `tasks-when-irina-online-2026-08-15.md` — что делать когда Ира на связи
- `irina-remote-access-rustdesk-2026-08-14.md` → DEPRECATED

⚠️ Telegram-токен утёк (3 раза в чате), ждём /revoke от Иры.

## Контекст (прочитай в начале)

1. `/Users/andrejorlov/Documents/my-project/prototype-ashet/` — исходник Бот №2
   (там же `companion.js`, `transcribe.js`, `clone_voice.js`, `compose_video.js`,
   `create_avatar.js`, `edit_image.js`, `generate_avatar_video.js`,
   `generate_image.js`, `generate_video.js`, `recall_memory.js`,
   `new_channels_client.sh`, `CHANNELS_CLIENT_PLAYBOOK.md`, `CLIENT_ONBOARDING.md`)
2. `/Users/andrejorlov/Documents/my-project/prototype-ashet/CLAUDE.md` —
   кастомный промт для Ириного бота (прочитай ОБЯЗАТЕЛЬНО)
3. `/Users/andrejorlov/Documents/my-project/prototype-ashet-publisher/` —
   исходник Бот №1 (publisher), companion.js, FIRST_RUN_PROMPT.md
4. `/Users/andrejorlov/Documents/my-project/prototype-ashet/IRINA_ONBOARDING_PROMPT.md` —
   промт для Ириного Claude Code
5. `/Users/andrejorlov/.claude/projects/-Users-andrejorlov-Documents-my-project-neurostaff/memory/` —
   index памяти (там `prototype-ashet-publisher-deployed-2026-08-15`,
   `tasks-when-irina-online-2026-08-15`, `irina-remote-access-tailscale-2026-08-15`)

## Что нужно сделать в этой сессии (3 трека, можно параллельно)

### Трек 1: Buffer-интеграция (ЧТО Я ДЕЛАЮ САМОСТОЯТЕЛЬНО, без Иры)

Ира пока не может подключить Buffer (она занята / не у компа). Я
разрабатываю всю Buffer-логику заранее, чтобы когда она пришлёт токен —
всё сразу заработало.

**Подзадачи:**

1. **Изучить Buffer API** (https://buffer.com/developers/api)
   - POST /v1/updates/create.json — создать пост в очереди
   - GET /v1/profiles — получить список подключённых каналов + ID
   - Authentication: Bearer token в headers
   - Scopes нужны: `client.publish`, `client.read`
   - Rate limits: ~50 updates/hour на free tier

2. **Создать модуль `buffer_client.js`** в `prototype-ashet-publisher/`:
   - `Buffer.createPost({token, profileId, text, mediaUrls, scheduledAt})`
   - `Buffer.listChannels(token)` — возвращает массив `{id, service, username}`
   - `Buffer.getProfile(token, profileId)` — детали канала
   - ENV: `BUFFER_ACCESS_TOKEN_*_PROTOTYPE_ASHET_PUBLISHER` (per-client token),
     `BUFFER_PROFILE_ID_*_PROTOTYPE_ASHET_PUBLISHER` (ID канала Иры)
   - Тестировать можно с моим собственным Buffer (если есть) или stub-режиме

3. **Расширить `/app/publish_request.js`** в `prototype-ashet-publisher/`:
   - Добавить параметр `--platform buffer` (или опцию `--use-buffer`)
   - Для `platform: "instagram"` через `media_type: image/video`:
     - Загрузить медиа в Buffer (multipart) → получить buffer-hosted URL
     - Создать update с этим URL + caption
     - Вернуть Buffer update ID как `request_id`
   - **ВАЖНО:** по умолчанию Buffer публикует по расписанию ИЛИ вручную.
     Режим "publish now" требует `scheduled_at: null` + `now=true` (только для Pro).

4. **approval-gateway → Buffer** двусторонний мост:
   - Сейчас approval-gateway живёт на `neurostaff-production.up.railway.app`
   - Нужно: когда Ольга нажимает «Опубликовать», Ира получит уведомление
     в Telegram от её бота (Бот №1), и уже Ира жмёт финальную кнопку
   - То есть двухступенчатое одобрение: Ольга → «готово» → Ира → «опубликовать»
   - Если это overkill — оставляем как сейчас (Ольга жмёт сама, Ира
     наблюдает)

5. **Тестовый сценарий** (без Иры, на моих тестовых ключах):
   - Создать тестовый Buffer-профиль через `Buffer.createProfile()`
   - Создать пост → проверить что в очереди появился
   - Удалить пост → `DELETE /v1/updates/:id`
   - Это можно сделать без реального Instagram, через "fake profile" mode

### Трек 2: Бот №2 — что подготовить для Иры (без её участия)

1. **Шаблоны постов под её нишу** (прочитать `CLAUDE.md`):
   - "Экспертный пост с болью" (5-7 коротких абзацев)
   - "Разбор кейса WB" (структура: контекст → что сделано → цифры)
   - "Личный пост (через предпринимательскую оптику)"
   - "Сторис-серия: 3-5 слайдов"
   - Captions под Instagram (с эмодзи-якорями под её стиль)

2. **CONTENT_PIPELINE.md** — задокументировать flow:
   - Оля (или её ассистент) → голосовое/текст в Бот №2
   - Бот №2 генерит черновик + 2-3 варианта подачи
   - Оля выбирает или правит
   - Бот №2 шлёт в approval-gateway
   - Ира одобряет в Telegram Бот №1
   - Бот №1 публикует через Buffer

3. **Метрики успеха** для бота (что собираем):
   - Время от голосового Оли до одобренного поста
   - % постов которые Ира одобрила с первого раза
   - % постов которые Оля правила >2 раз
   - Engagement на опубликованных постах (через Buffer analytics)

### Трек 3: Что делать КОГДА Ира выйдет на связь

(Полный список в `memory/tasks-when-irina-online-2026-08-15.md`,
здесь — только то что относится к Buffer-коннекту)

- Ира переводит Instagram в Professional (Business) аккаунт
- Ира регистрируется в buffer.com → Free тариф
- Подключает Instagram через OAuth в Buffer
- Берёт **Buffer Access Token** в https://publish.buffer.com/settings/api
- Берёт **Buffer Profile ID** (GraphQL-запрос ИЛИ через API):
  - `curl -H "Authorization: Bearer <TOKEN>" https://api.bufferapp.com/1/profiles.json`
  - Возвращает массив profiles, нужный `id` для Instagram
- Передаёт ОБА токена Андрею безопасным каналом (1Password Send / Bitwarden Send)

После этого я делаю:
- `railway variable set BUFFER_ACCESS_TOKEN_PROTOTYPE_ASHET_PUBLISHER=... --service prototype-ashet-publisher`
- `railway variable set BUFFER_PROFILE_ID_PROTOTYPE_ASHET_PUBLISHER=... --service prototype-ashet-publisher`
- Тест: `node /app/publish_request.js --platform instagram --media-type image --media test.jpg --caption-file /tmp/test.txt`

## Архитектурные решения, которые нужно принять в этой сессии

1. **Двухступенчатое одобрение (Ольга → Ира) или одно (только Ира)?**
   - Ира — конечный publisher. Ольга — генератор контента.
   - Сейчас логика: бот публикует то, что одобрила **Ольга**.
   - Новая логика: бот публикует то, что одобрила **Ира**.
   - Вариант A: бот шлёт Ире на одобрение всё, что сгенерил для неё
   - Вариант B: Оля одобряет «качество текста», Ира одобряет «готово к выходу»
   - Вариант C: авто-публикация (только если Ира сама попросит — НЕ предлагать)
   - Решение: вариант A (проще, Ира = единая точка решения для своего бренда)

2. **Content generation: Бот №2 vs Андрей лично?**
   - Сейчас Бот №2 общается с Олей через Telegram
   - Нужно: Бот №2 умеет по запросу Бот №1 сгенерить пост по теме от Оли
   - Прямое API между ними (REST) или webhook?
   - Решение: REST endpoint на Бот №2 (`/api/generate`) который Бот №1 дёргает

3. **Хранение медиа:**
   - Сейчас все медиа локально в `/data/...` внутри контейнера Бот №2
   - Для публикации нужно: либо шарить между двумя ботами через общий storage
     (S3 / R2 / Railway volume), либо передавать через API (multipart)
   - Решение: для начала — передача через API (base64 в JSON, 1-5 МБ хватит);
     если картинки тяжелее — переходить на R2/S3

## План сессии (что я буду делать по минутам)

0. **00:00–05:00** Прочитать все memory файлы + IRINA_ONBOARDING + CLAUDE.md от Bot #2
1. **05:00–25:00** Buffer-клиент + интеграция с publish_request.js
2. **25:00–45:00** CONTENT_PIPELINE.md + шаблоны постов
3. **45:00–60:00** Архитектурные решения (зафиксировать в `memory/architecture-decisions-bot1-bot2.md`)
4. **60:00–75:00** Код двухступенчатого одобрения (если выбрали вариант B)
5. **75:00–90:00** Тесты и проверка что ничего не сломал в Бот №1

Если что-то делаешь с расходами (платные API, S3, R2) — СТОП,
спроси Андрея. OpenAI/Runway/Buffer — лимиты есть, не жги без подтверждения.

——— END ———

---

## Как передать Андрею

Просто скопируй текст между `——— START ———` и `——— END ———` в новый чат.
Claude Code следующей сессии подхватит контекст из memory + CLAUDE.md +
этого промта.
