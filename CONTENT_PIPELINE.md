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

Решение: **REST с JSON через общий neurostaff** (рекомендация из SESSION_PROMPT_OFFLINE §2.3, строка 73). Альтернатива webhook отклонена — REST проще дебажить и мониторить в `super_bot.py`.

Контракт (черновик):

```http
POST /internal/publish_draft
Headers:
  X-Client-Slug: ashet-irina
  X-Internal-Secret: <shared between bot#1 and bot#2>
  Content-Type: application/json
Body:
  {
    "platform": "instagram" | "telegram_channel" | "telegram_story_personal" | "telegram_story_channel",
    "content_type": "post" | "story" | "reel",
    "media_type": "image" | "video",
    "media_url": "https://r2.example.com/.../img.png",  // presigned URL, не base64
    "caption_file_id": "<memory-recall-id>",
    "draft_id": "<uuid>",
    "created_by": "bot-2-prototype-ashet-dev"
  }
```

**Хранение медиа между ботами:** Cloudflare R2 (или любой S3-совместимый) с **presigned URL**. Base64 НЕ используется — не масштабируется для видео (рекомендация SESSION_PROMPT_OFFLINE §2.3).

## Раздел 4: Approval-gateway — точка согласования

Нишевый блок пока пустой, но **архитектура жёсткая** (правило из `memory/architect-andrey-profile.md`):

- Бот №1/№2 НИКОГДА не получают реальный ключ Instagram/Buffer
- Утверждение — **только Ира** (она платит, она решает). Двухступенчатое одобрение (Ира→Оля) **отклонено** для этого клиента — это другой клиент, другая история
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

- **2026-08-16** — черновик архитектуры, нишевый блок пустой (Ира не дала позиционирование). Привязка к существующему `neurostaff/publish_gateway.py`.
