# CONTENT_PIPELINE — шаблон для Ирины (Бот №2)

> **Статус (16.08.2026):** черновик архитектуры. Конкретные темы и форматы — **после того, как Ира даст позиционирование** (заблокировано из `memory/next-session-bot2-buffer-2026-08-15.md`).
>
> **Назначение:** единая схема того, как мысль Иры превращается в опубликованный пост в её Instagram/Telegram. Привязка к существующему approval-gateway в `neurostaff/publish_gateway.py` (per-client секрет, ссылка с кнопкой «Опубликовать»).

---

## Архитектурная диаграмма (high-level)

```
┌──────────────────────────────────────────────────────────────────┐
│ Ирина в Telegram (@verba_irina, chat_id 418524161)               │
│ — голосовое / видео / текст                                       │
└─────────────────────────┬────────────────────────────────────────�
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│ Bot #2: prototype-ashet-dev (этот контейнер)                     │
│ — Whisper (transcribe.js) → текст                                 │
│ — Content Agent (Claude Code):                                    │
│     • вытащить главную мысль                                      │
│     • 2–3 варианта подачи                                         │
│     • выбрать формат (post / story / reel / карусель)            │
│ — companion.js: постфактум-проверка качества текста               │
└─────────────────────────┬────────────────────────────────────────┘
                          │ черновик + медиа
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│ Bot #1: prototype-ashet-publisher (другой контейнер, тот же TG-бот)│
│ — получает финальную подпись + media_path                          │
│ — НИКОГДА не публикует сам                                         │
│ — POST /publish_request на approval-gateway:                       │
│     curl -X POST "$PUBLISH_GATEWAY_URL_REQUEST"                   │
│        -H "X-Gateway-Secret: $PUBLISH_GATEWAY_SECRET_ASHET_IRINA"│
│        -H "X-Client-Slug: ashet-irina"                            │
│        -d '{"platform":"instagram","content_type":"post",        │
│             "media_type":"image","media":"/tmp/img.png",          │
│             "caption_file":"/tmp/caption.txt"}'                   │
└─────────────────────────┬────────────────────────────────────────┘
                          │ заявка в БД, status=pending
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│ Approval-gateway (neurostaff/publish_gateway.py)                  │
│ — кладёт заявку в таблицу publish_requests                          │
│ — шлёт Ирине в Telegram одноразовую ссылку с inline-кнопками:    │
│     [Опубликовать] [Отклонить] [Редактировать]                    │
│ — реальная публикация ТОЛЬКО после явного клика Ириной            │
└─────────────────────────┬────────────────────────────────────────┘
                          │ клик «Опубликовать»
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│ Meta Graph API (если Instagram + Meta App готов)                   │
│   ИЛИ                                                              │
│ Buffer API (если Buffer подключён, fallback / отложенная публикация)│
└──────────────────────────────────────────────────────────────────┘
```

---

## Раздел 1: Вход — что Ирина присылает

(Заполнится после первой сессии — форматы: голосовое / видео-кружок / текст с фото / просто мысль).

## Раздел 2: Content Agent — что делает бот №2

(Заполнится после того, как Ира даст позиционирование — сейчас только каркас):

1. **Транскрибация** (если голосовое/видео) — `transcribe.js` через Groq Whisper
2. **Извлечение мысли** — Claude Code по `prototype-ashet/CLAUDE.md` (нишевый блок пока пустой)
3. **2–3 варианта подачи** — короткий/средний/длинный, разный тон
4. **Выбор формата:**
   - **Post (image + caption)** — Instagram feed, Telegram-канал
   - **Story** — личный TG / канал (24ч)
   - **Reel** — короткое видео 9:16, до 90 сек
   - **Carousel** — несколько фото с подписями
5. **Генерация медиа** (если нужно) — OpenAI/Runway (после того, как Ира подключит ключи)

## Раздел 3: Передача в Bot #1 — API между ботами

**Решение:** **REST с JSON через общий neurostaff** (рекомендация из `memory/next-session-bot2-buffer-2026-08-15.md` §2.3). Webhook отклонён — REST проще дебажить и мониторить в `super_bot.py`. Альтернативно можно туннелировать через БД (poll-based), но это +1 round-trip.

**Базовый URL:** `https://neurostaff-production.up.railway.app` (тот же, что для approval-gateway).

**Auth:** общий секрет в ENV обоих ботов (`INTERNAL_API_SECRET_ASHET_IRINA` или fallback на `PUBLISH_GATEWAY_SECRET_ASHET_IRINA` если секрет общий между двумя).

**Идентификация клиента:** `X-Client-Slug: ashet-irina` header.

---

### 3.0. Загрузка медиа (presigned URL)

Bot #2 НЕ отдаёт base64 Bot #1 — больно для видео. Сначала грузит в общее R2/S3 хранилище.

```http
POST /upload-media
Headers:
  X-Client-Slug: ashet-irina
  X-Internal-Secret: <shared>
  Content-Type: multipart/form-data
Body:
  file=<binary>
  kind=image|video
Response 200:
  {
    "ok": true,
    "file_id": "ashet-irina/2026-08-17/img_abc123.jpg",
    "url": "https://r2.example.com/ashet-irina/2026-08-17/img_abc123.jpg?signature=...&expires=..."
  }
```

**Реализация:** существующий `POST /upload-media` в `neurostaff/publish_gateway.py:_handle_upload_media` уже подходит. Расширить: возвращать `file_id` для последующих `POST /publish_draft`.

**Expiry:** presigned URL действует 24 часа. Drafts старше 24ч с истёкшим URL → перезагрузка.

---

### 3.1. Blackbox-описание (для будущей реализации)

```http
POST /internal/publish_draft
Headers:
  X-Client-Slug: ashet-irina
  X-Internal-Secret: <shared>
  Content-Type: application/json
Body:
  {
    "draft_id": "<uuid>",                            # генерит Bot #2
    "platform": "instagram" | "telegram_channel" | "telegram_story_personal" | "telegram_story_channel",
    "content_type": "post" | "story" | "reel" | "carousel",
    "media_type": "image" | "video",
    "media_url": "https://r2.example.com/.../img.png?signature=...",
    "media_id": "ashet-irina/2026-08-17/img_abc123.jpg",  # для возможного re-upload
    "caption": "полный текст подписи",                # НЕ через файл — JSON
    "scheduled_at": null | "2026-08-17T15:00:00+03:00",
    "trial": false,                                   # если trial=true — публикация с пометкой
    "share_to_feed": null | true,                     # только для Reels
    "created_by": "bot-2-prototype-ashet-dev",
    "source_message_id": "<tg message_id>",           # для трассировки
    "metadata": {
      "topic": "...",
      "hook": "...",
      "call_to_action": "..."
    }
  }
Response 200:
  {
    "ok": true,
    "draft_id": "<uuid>",
    "status": "awaiting_approval",
    "approval_url": "https://t.me/irina_approve_bot?start=approve_<req_id>"
  }
Response 4xx:
  400 — невалидный JSON / отсутствует обязательное поле
  401 — неверный X-Internal-Secret
  413 — media_url слишком большой
  503 — approval-gateway недоступен (Bot #1 retry через 5 сек)
```

**Ошибки Bot #2 при получении 5xx:** retry 3 раза с exponential backoff (1s, 5s, 25s). Если 503 — Bot #2 говорит Ире «approval-gateway лежит, попробуем позже», не публикует.

---

### 3.2. Статус draft-а (идемпотентный запрос)

```http
GET /internal/publish_draft/<draft_id>
Headers:
  X-Client-Slug: ashet-irina
  X-Internal-Secret: <shared>
Response 200:
  {
    "ok": true,
    "draft_id": "<uuid>",
    "status": "awaiting_approval" | "approved" | "published" | "rejected" | "failed",
    "publish_request_id": "<int>",  # id в БД publish_requests
    "created_at": "2026-08-17T12:00:00Z",
    "approved_at": null | "2026-08-17T12:05:00Z",
    "published_at": null | "2026-08-17T12:05:30Z",
    "error": null | "OAuth token expired"
  }
```

**Status flow:** `awaiting_approval` → `approved` (Ира нажала «Опубликовать») → `published` (через Meta/Buffer) → `failed` (если ошибка).

---

### 3.3. Edit (Ира правит draft)

```http
PATCH /internal/publish_draft/<draft_id>
Headers:
  X-Client-Slug: ashet-irina
  X-Internal-Secret: <shared>
Body:
  { "caption": "новый текст" | "media_url": "новый URL" }
Response 200:
  { "ok": true, "draft_id": "...", "updated_at": "..." }
```

**Поведение:** если draft в статусе `awaiting_approval` — обновляет текст/медиа, approval-gateway шлёт Ире **новое** сообщение с кнопками (старое остаётся как история, но неактивно). Если уже `published` — 409 Conflict.

---

### 3.4. Reject (Ира отклонила)

```http
POST /internal/publish_draft/<draft_id>/reject
Headers:
  X-Client-Slug: ashet-irina
  X-Internal-Secret: <shared>
Body:
  { "reason": "холодно, переделай" }  # опционально
Response 200:
  { "ok": true, "status": "rejected" }
```

**Поведение:** Bot #2 получает status=`rejected` через polling (см. 3.2) — если reason есть, можно перегенерировать. Bot #2 НЕ делает автоматический retry — это согласовано в Архитектурном решении 16.08 (см. §4).

---

### 3.5. Notification (Bot #1 → Ира)

```http
POST /internal/notify_client
Headers:
  X-Client-Slug: ashet-irina
  X-Internal-Secret: <shared>
Body:
  {
    "text": "✅ Опубликовано в Instagram: <short_url>",
    "reply_to_draft_id": "<uuid>"  # опционально, для трединга
  }
Response 200:
  { "ok": true, "telegram_message_id": 12345 }
```

**Когда вызывается:** из existing handlers `publish_gateway.py:_notify_client()` — эта функция уже шлёт fallback-сообщения. Новый endpoint — интерфейс для Bot #2 чтобы дёрнуть тот же путь.

---

### 3.6. Хранение в БД (publish_requests)

Одна таблица на всех клиентов (per-VPS), `publish_gateway.py` использует существующую схему:

```sql
CREATE TABLE publish_requests (
  id              BIGSERIAL PRIMARY KEY,
  client_slug     VARCHAR(64) NOT NULL,
  status          VARCHAR(16) NOT NULL,  -- pending|approved|published|rejected|failed
  platform        VARCHAR(32),
  content_type    VARCHAR(16),
  media_type      VARCHAR(16),
  media_url       TEXT,
  media_id        TEXT,
  caption         TEXT,
  scheduled_at    TIMESTAMPTZ,
  trial           BOOLEAN DEFAULT FALSE,
  share_to_feed   BOOLEAN,
  draft_id        UUID,  -- генерит Bot #2
  source_message_id BIGINT,
  metadata        JSONB,
  created_at      TIMESTAMPTZ DEFAULT now(),
  approved_at     TIMESTAMPTZ,
  published_at    TIMESTAMPTZ,
  error           TEXT,
  -- existing fields:
  request_payload JSONB,
  result_payload  JSONB
);

CREATE INDEX idx_publish_draft_id ON publish_requests(draft_id);
```

**Почему draft_id UUID, а не BIGSERIAL:** Bot #2 генерит UUID заранее (до того как approval-gateway создал запись в БД). Это даёт idempotency — Bot #2 может безопасно retry POST /publish_draft с тем же draft_id.

---

### 3.7. Что уже реализовано в neurostaff (по состоянию на 17.08.2026)

| Endpoint | Реализован | Источник |
|---|---|---|
| POST /publish-request | ✅ | `publish_gateway.py:_handle_publish_request_post` |
| POST /client-decide | ✅ | `publish_gateway.py:_handle_client_decide_post` |
| POST /upload-media | ✅ | `publish_gateway.py:_handle_upload_media` |
| POST /relay-telegram-media | ✅ | для паблишеров без своего R2 |
| GET /client-decide (HTML) | ✅ | страница с inline-кнопками |
| GET /media/{file} | ✅ | статика |
| POST /internal/publish_draft | ❌ | нужно дописать (прозрачный wrapper над /publish-request + draft_id) |
| GET /internal/publish_draft/<id> | ❌ | нужно дописать (SELECT по draft_id) |
| PATCH /internal/publish_draft/<id> | ❌ | нужно дописать (UPDATE если status=pending) |
| POST /internal/publish_draft/<id>/reject | ❌ | нужно дописать (UPDATE status=rejected) |
| POST /internal/notify_client | ❌ | нужно дописать (прозрачный wrapper над _notify_client) |

**Оценка трудоёмкости:** 5 эндпоинтов × 30–60 строк = 150–300 строк в `publish_gateway.py`. Можно сделать одним PR после того, как Bot #2 подключит Ира.

---

### 3.8. ENV контракт (Bot #2 → neurostaff)

Bot #2 (prototype-ashet-dev) в своём `.env`:
```bash
NEUROSTAFF_BASE_URL=https://neurostaff-production.up.railway.app
INTERNAL_API_SECRET_ASHET_IRINA=<shared with Bot #1>
PUBLISH_GATEWAY_SECRET_ASHET_IRINA=<existing, fallback>
```

Bot #1 (prototype-ashet-publisher) — те же ENV (он и так публикует).

Neurostaff — ничего нового, все секреты уже есть.

---

**Хранение медиа между ботами:** Cloudflare R2 (или любой S3-совместимый) с **presigned URL**. Base64 НЕ используется — не масштабируется для видео (рекомендация из `memory/next-session-bot2-buffer-2026-08-15.md` §2.3).

## Раздел 4: Approval-gateway — точка согласования

Нишевый блок пока пустой, но **архитектура жёсткая** (правило из `memory/architect-andrey-profile.md`):

- Бот №1/№2 НИКОГДА не получают реальный ключ Instagram/Buffer
- **Решение 16.08.2026 (Андрей):** одноступенчатое одобрение — **только Ира** (она платит → она решает). Двухступенчатое (Ира→Оля) **отклонено** для этого клиента — это другой клиент, другая история
- Гейт шлёт Ире одноразовую ссылку с inline-кнопками. Реальная публикация после клика, технически а не на честном слове

ENV, которые должен выставить Андрей:

```bash
PUBLISH_GATEWAY_SECRET_ASHET_IRINA=<random>
TELEGRAM_BOT_TOKEN_ASHET_IRINA=<bot token>  # если отличается от основного
CLIENT_CHAT_ID_ASHET_IRINA=418524161
MEMORY_GATEWAY_SECRET_ASHET_IRINA=<random>
KNOWLEDGE_GATEWAY_SECRET_ASHET_IRINA=<random>
CALENDAR_GATEWAY_SECRET_ASHET_IRINA=<random>

# Instagram:
META_IG_APP_ID_ASHET_IRINA=<App ID от Meta App Иры>
META_IG_APP_SECRET_ASHET_IRINA=<App Secret>
# OAuth-redirect: https://neurostaff-production.up.railway.app/oauth/instagram/callback

# Buffer (резервный канал):
BUFFER_ACCESS_TOKEN_ASHET_IRINA=<от Buffer Иры>
BUFFER_CHANNEL_ID_ASHET_IRINA=<channel id>
```

## Раздел 5: Публикация — Meta vs Buffer

Роутинг уже реализован в `neurostaff/instagram_publish.py` (см. `memory/buffer-integration-already-implemented.md`):

- **Meta Graph API** — основной путь (после того, как Ира создаст свой Meta App и пройдёт App Review, ~1–2 недели блокер)
- **Buffer** — fallback (если Meta упала / нужна отложенная публикация на конкретное время / даты-чувствительный контент)

## Раздел 6: Мониторинг (после подключения Иры)

Добавить в `neurostaff/super_bot.py` (см. SESSION_PROMPT_OFFLINE §2.5):

```python
async def _prototype_ashet_publisher_quality_job(context):
    """Health-check Bot#1 каждые 5 мин."""
    url = os.environ["COMPANION_URL_PROTOTYPE_ASHET_PUBLISHER"]
    secret = os.environ["COMPANION_SECRET_PROTOTYPE_ASHET_PUBLISHER"]
    try:
        r = requests.get(f"{url}/status", headers={"X-Companion-Secret": secret}, timeout=5)
        if r.status_code != 200:
            alert_admin(f"prototype-ashet-publisher health: {r.status_code}")
    except Exception as e:
        alert_admin(f"prototype-ashet-publisher unreachable: {e}")
```

---

## Что заблокировано до ввода от Ирины

| Пункт | Что нужно от Ирины |
|---|---|
| Позиционирование / ниша | Свободный рассказ на 5–10 минут о чём её блог, кто аудитория, какие боли закрывает |
| Meta App App ID + Secret | Шаги 1–5 из `prototype-ashet-publisher/META_APP_SETUP_INSTRUCTIONS.md` (регистрация её App, ~40 минут) |
| Buffer Access Token + Channel ID | Регистрация на buffer.com (если она выбирает Buffer как основной канал — fallback уже есть) |
| Telegram-канал для публикации | Имя канала + бот должен быть добавлен как admin |
| HeyGen-аватар (если нужен) | Ключи + Dockerfile-фикс для `clone_voice.js`/`create_avatar.js` |

---

## Открытые архитектурные вопросы (на потом)

1. **Draft preview перед approval-gateway** — показывать ли Ире превью поста (картинку + подпись) ДО отправки в approval-gateway? Сейчас: да, через reply в Telegram с медиа.
2. **Edit flow** — кнопка «Редактировать» в approval-gateway → возврат в Bot №2 с правками? Сейчас: отклонено для MVP, Ира пишет правки текстом в TG, бот перегенерирует.
3. **Scheduled posts** — есть `migration_16_scheduled_publish.sql`, но нужен ли Ире UI для расписания? Решим после первой сессии.
4. **A/B варианты подписи** — если Bot №2 выдаёт 3 варианта, а Ира хочет протестировать 2 — отдельная фича, не для MVP.

---

## Changelog

- **2026-08-17** — §3 «Передача в Bot #1» переписан: полная REST API спецификация (7 endpoints, ENV, SQL, статусная диаграмма). Добавлен §3.7 «Что уже реализовано» — зафиксировано, что 5/10 endpoints в neurostaff уже работают, 5 нужно дописать (~250 строк).
- **2026-08-16** — черновик архитектуры, нишевый блок пустой (Ира не дала позиционирование). Привязка к существующему `neurostaff/publish_gateway.py`.
- **2026-08-16** — зафиксировано решение по одобрению: одноступенчатое (только Ира). Решение выпечено в §4 «Approval-gateway».
