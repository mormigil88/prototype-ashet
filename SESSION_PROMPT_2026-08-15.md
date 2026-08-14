# Промт для следующей сессии по Ире — 15.08.2026+

Копируй от `——— START ———` до `——— END ———` в новый чат с Claude Code.
Это **вторая сессия** после деплоя + пейринга 14.08.2026.

——— START ———

Продолжаем работу с первым клиентом по модели Channels-as-a-Service.
Ирина — контент-ассистент в её Telegram, проект `prototype-ashet`
развёрнут в её Railway workspace. Бот живой, идёт первая сессия —
Ира отвечает на онбординг-вопросы про нишу.

## Что было сделано в прошлой сессии (14.08.2026)

✅ Бот развёрнут и пейринг закрыт:
- `dmPolicy=allowlist`, `allowFrom=["419465595","418524161"]`
- `pending: {}` (почищен баг, где искал `user_id` вместо `senderId`)
- Telegram-плагин читает `access.json` корректно, сообщения идут в Claude

✅ Claude-сессия активна и общается с Ирой:
- `--continue` (найдена предыдущая сессия от 13.08.2026)
- 43+ turns, последний сегодня
- Бот задаёт Ире онбординг-вопросы по `CLAUDE.md`

✅ `CLAUDE.md` кастомизирован под Иру (31388 байт, в `/app/CLAUDE.md`
внутри контейнера):
- Онбординг-скрипт для первой сессии
- Реалистичные статусы фич (что работает / что упало бы)
- Чёткое «не путать с Ольгой» (другой `client_slug=ashet-olga`)

✅ Dockerfile фикс — `clone_voice.js` и `create_avatar.js` теперь
копируются в образ (раньше были в репо, но не в `/app/`)

✅ `recall_memory.js` берёт `CLIENT_SLUG` из env (был хардкод `ashet-olga`)

✅ Debug-эндпоинты `/admin/stat` и `/admin/touch` (оставить до 28.08.2026,
помечены комментарием в `companion.js`)

## Контекст (прочитай в начале)

1. `/Users/andrejorlov/Documents/my-project/prototype-ashet/` — исходник
2. `/Users/andrejorlov/Documents/my-project/prototype-ashet/CLAUDE.md` —
   кастомный промт для Ириного бота
3. `/Users/andrejorlov/Documents/my-project/prototype-ashet/companion.js` —
   админ-эндпоинты (`/admin/allowlist`, `/admin/allowlist/add`,
   `/admin/ping`, `/admin/stat`, `/admin/touch`, `/admin/fs`)
4. `/Users/andrejorlov/Documents/my-project/prototype-ashet/IRINA_ONBOARDING_PROMPT.md` —
   промт для Ириного Claude Code (на её макбуке)
5. `/Users/andrejorlov/.claude/projects/-Users-andrejorlov-Documents-my-project-neurostaff/memory/MEMORY.md` —
   index памяти (там `prototype-ashet-publisher-prep` и
   `prototype-ashet` ссылки)

## Что осталось доработать по договору (14 дней, дедлайн ~28.08.2026)

### Договор
- Цена 400 000 ₽, 14 дней
- Платёж 1 (100к) поступил 14.08.2026 — стартовая точка
- Остаток 300к — по графику, который ещё не согласован

### Обязательные шаги (без них бот остаётся «полу-функциональным»)

#### 1. Подключить OPENAI_API_KEY (для картинок)
- Ира регистрирует на platform.openai.com сама, платит со своей карты
- Присылает ключ через безопасный канал (1Password / Bitwarden Send /
  onetimesecret), НЕ через Telegram
- Андрей добавляет в Railway Variables (`OPENAI_API_KEY=... --skip-deploys`)
- После этого `generate_image.js` начинает работать, бот сможет рисовать
  обложки постов, иллюстрации, сторис

#### 2. Подключить Buffer или Meta App для Instagram-публикации
- **Buffer** (быстрее, ~1 день): Ира даёт доступ к её Buffer-аккаунту →
  подключаем через `PUBLISH_GATEWAY_URL` + `PUBLISH_GATEWAY_SECRET`
- **Meta App** (дольше, ~1-2 недели на App Review): создать приложение,
  пройти ревью, получить long-lived token
- Пока подключения нет, Ира публикует руками через Instagram-приложение
- Approval-gateway уже встроен в шаблон (готовность 100%, только секреты)

#### 3. Онбординг Иры в боте (уже идёт)
- Claude задаёт вопросы по одному за реплику (ниша, ЦА, тон, форматы,
  табу) — записывает каждый ответ через `/remember` под
  `client_slug:ashet-irina`
- Следить чтобы память действительно записывалась — после первых 2-3
  фактов сделать `recall` через memory-gateway и убедиться что они там

### Желательные (но не блокируют сдачу)

#### 4. RUNWAY_API_KEY (для видео)
- Ира регистрирует на runwayml.com, платно
- Та же схема что с OpenAI — прислать ключ безопасным каналом, Андрей
  кладёт в Railway

#### 5. HeyGen (голосовой аватар)
- Нужен фикс: сейчас `clone_voice.js`/`create_avatar.js` в образе, но
  нет ключей HeyGen
- Ира даёт согласие на клонирование голоса + присылает фото для аватара
- Запускаем `clone_voice.js` (создаёт voice_id) и `create_avatar.js`
  (создаёт avatar_id), кладём `HEYGEN_VOICE_ID_*` / `HEYGEN_AVATAR_ID_*`
  в env
- `generate_avatar_video.js` уже в образе, готов

#### 6. Telegram-канал Иры (опционально)
- Сейчас бот общается только в DM
- Если Ира захочет, чтобы бот постил в её Telegram-канал — нужно:
  1. Она добавляет `@KimiMercedes_bot` в канал как admin
  2. Включает posting rights
  3. Андрей добавляет переменные `TELEGRAM_CHANNEL_ID` (chat_id канала)
- В `CLAUDE.md` уже есть инструкция как публиковать в telegram_channel

### Завершение договора

#### 7. Сдача работы
- Записать loom/видео или сделать скринкаст: «как пользоваться ботом»
- Дать Ире контакты для связи если что-то сломается
- Согласовать приёмку: бот отвечает на её задачи, рилсы готовятся,
  публикация работает через approval-gateway

#### 8. Финальная оплата
- После приёмки — последний платёж по графику
- Сделать акт/закрытие проекта

#### 9. Очистка debug-кода (после 28.08.2026)
- Удалить `/admin/stat` и `/admin/touch` из `companion.js`
- Если Ира не против, оставить `/admin/allowlist` и `/admin/allowlist/add`
  для будущих клиентов в её workspace (если она сама будет добавлять
  новых пользователей)

## Чего НЕ делать

- НЕ публикуй ничего от имени Иры без её явного одобрения (это правило
  её `CLAUDE.md`, бот его соблюдает)
- НЕ запускай платные AI-сервисы (Runway, OpenAI, HeyGen) без её
  одобрения суммы
- НЕ редактируй `access.json` напрямую в `/data/claude-home/channels/telegram/`
  — используй `/admin/allowlist/add`
- НЕ ломай `recall_memory.js` — это единственный способ боту помнить
  между сессиями
- НЕ переименовывай `CLIENT_SLUG` в env (должен остаться `ashet-irina`)
- НЕ удаляй debug-эндпоинты раньше 28.08.2026 (помечены в `companion.js`)

## Полезные команды

```bash
# Залогиниться в Ирин Railway
railway link --project prototype-ashet

# Логи контейнера
railway logs --service prototype-ashet --lines 50

# Текущие переменные (без значений секретов)
railway variables --kv | grep -v "_KEY\|_SECRET\|_TOKEN"

# Пинговать Иру через бота (для проверки)
curl -s -X POST https://prototype-ashet-production.up.railway.app/admin/ping \
  -H "X-Companion-Secret: $COMPANION_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"chat_id":"418524161","text":"..."}'

# Проверить память (что бот записал про Иру)
curl -s -X POST "$MEMORY_GATEWAY_URL_RECALL" \
  -H "X-Gateway-Secret: $MEMORY_GATEWAY_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"client_slug":"ashet-irina","query":"ниша тон аудитория"}'
```

## Старт

Начни с чтения `/turns` — посмотри последние сообщения от Иры и
убедись, что онбординг идёт нормально. Если Ира уже рассказала про
свою нишу — посмотри через `/recall`, что записалось в память.
Дальше — по плану выше, в порядке приоритетов (обязательные → желательные).

——— END ———

---

## Как использовать

1. Сохрани этот файл: `/Users/andrejorlov/Documents/my-project/prototype-ashet/SESSION_PROMPT_2026-08-15.md`
2. В новом чате скопируй текст между `——— START ———` и `——— END ———`
3. Вставь первым сообщением в Claude Code
4. Клод сам прочитает CLAUDE.md, companion.js, IRINA_ONBOARDING_PROMPT.md
   и подхватит контекст