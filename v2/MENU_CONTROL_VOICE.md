# Menu Control · Шаурмег only

## Scope
The coordinator Telegram bot @Anukadavaikavihodibot serves **only Shaurmeg** venue menus. No outbound calls, project resolution, role bindings, keys, or configuration from Kofeyok are used.

This release does **not** change the independent Kofeyok project or its production services. Pre-existing historical database records are retained to avoid destructive migrations; pending records for other projects are expressly rejected during confirmation.

## How to connect an establishment
1. Open the **Shaurmeg** venue administration → `Идентификаторы меню`. Generate a one-time `SHA-MNU-<16 hex chars>` key (24 hours by default). Do not share the key publicly.
2. Open [the coordinator Telegram bot](https://t.me/Anukadavaikavihodibot) in a **private chat**.
3. Send `/connect SHA-MNU-...` or send the full key as a standalone private message. The server verifies and consumes the key and binds **that Telegram account** to exactly **one Shaurmeg venue**.
4. Alternatively open the coordinator Mini App from the bot menu and enter the same key in the `Подключить заведение` field. Only signed Telegram WebApp `initData` can use this action.
5. Check `/status`, then `/menu` or `/menu шаурма` to search venue-local IDs. In the Mini App, you see only the bound Shaurmeg venue.
6. Send a textual or voice command. The bot resolves the exact venue-local immutable code and asks for explicit confirmation before changing menu data.

### Common commands
- `/start`, `/status`, `/menu`, `/menu шаурма`
- `Убери сырную шаурму` / `Верни сырную шаурму в продажу`
- `Измени цену на сырную шаурму 350`
- `Переименуй сырную шаурму в Сырная шаурма XL`
- `Измени описание сырной шаурмы на Фирменный соус`
- `Добавь халапеньо в сырную шаурму`
- `Убери сыр из сырной шаурмы`
- `Замени состав сырной шаурмы на курица, лаваш, сыр`
- `Отключи раздел Напитки`
- `P012ABC состав + сыр` and other menu-code commands

## Security guarantees
- One Telegram ID → at most one active Shaurmeg venue binding at a time; distinct venues cannot be modified via user-supplied venue IDs.
- Menu IDs are venue-scoped; duplicate names require clarification, and ingredients must belong to the selected dish.
- Proposed changes require single-use three-minute confirmation and revalidate Telegram actor, venue, internal ID, kind and code.
- Existing coordinator executor logs audit records, updates the right Shaurmeg venue and emits real-time menu refreshes.
- Former cross-project confirmation records are rejected. This release does not erase historical records or alter third-party projects.
- No unattended listening: audio is recorded only through explicit Telegram/Mini App microphone actions.
- Time-limited "until tomorrow" commands are refused until scheduling is implemented.

## Production / diagnostics
- Render service: `shaurma-city-api` at `https://shaurma-city-api.onrender.com`.
- Health (public, nonsecret): `/api/v2/telegram/coordinator-health` should return `project:"shaurmeg"`, and true for `enabled`, `webhookSecured`, `miniAppConfigured`, `voiceConfigured` where configured.
- Mini App: `/realcity-preview/coordinator-console.html` must be opened from the Telegram bot so signed `initData` is available.
- Required variables: `COORDINATOR_BOT_TOKEN` and `COORDINATOR_WEBHOOK_SECRET`; speech requires `COORDINATOR_STT_API_KEY` or `OPENAI_API_KEY`.
- No bridge credentials or environment variables for other projects are used by Menu Control. Previous unused env variables can be retired manually in Render settings after verification.
- End-to-end test must be conducted on a deliberately designated test item: connect, catalog, preview, confirm, inspect menu and audit log. Do not change live restaurant prices as a smoke test.

## Локальный диалоговый агент v1

Новый слой `coordinator-dialogue.js` выполняется **внутри сервера Шаурмега** (детерминированные словари/правила, без внешнего LLM и без вымышленных ответов). Это начальная ступень разговорного ИИ; генеративная локальная модель, длительная память и произвольные рассуждения **ещё не подключены**.

### Диалог
- `Привет`, `Что ты умеешь?`, `Спасибо`.
- `Убери сырную` → уточнить похожие блюда → `вторую` или полный код → повторно проверить сущность → показать подтверждение.
- `Поставь цену 350` без контекста → спросить блюдо → `Сырная шаурма` → показать изменение до сохранения.
- `Сколько стоит сырная шаурма?`, `Из чего состоит ...?`, `Есть ли ... в меню?`.
- `Сколько блюд в меню?`, `Что в стоп-листе?`, `Что изменилось?`, `Что изменилось за последние 24 часа?`.
- `Поставь 400`, `Убери её` после однозначного выбора последней позиции.
- `Сброс` или `/reset` очищает разговорный контекст.

### Принципы
- Контекст хранится в PostgreSQL `shaurma_coordinator_dialogue`: Telegram ID, конкретное заведение, короткие коды и выбор; TTL 15 минут. **Тексты разговоров и звук в этой таблице не хранятся**.
- При следующем сообщении сущность сверяется с актуальным каталогом по immutable ID + виду + коду. После смены заведения чужой контекст автоматически недоступен.
- Ответы о цене и составе читаются из `shaurma_venues.menu` именно привязанного заведения. Отчёт изменений читается из `shaurma_coordinator_audit` с `WHERE establishment_id=$1`.
- `Что изменилось за 24 часа?` фильтрует журнал по реальным 24 часам; просто `Что изменилось?` показывает последние 8 записей за всё время.
- Сводка стоп-листа учитывает **явные флаги** availability/active/blocked ingredients, а не расписание, и прямо сообщает об этом.
- Агент может предложить команду, но не исполняет её: существующие проверки полномочий, кодов, confirmation TTL и audit не обходятся.
- Текст, голосовое сообщение Telegram и запись через Mini App используют **один и тот же локальный разговорный модуль**. В Mini App голосовая фраза после распознавания отправляется агенту автоматически; изменение меню всё равно требует нажатия подтверждения.
- **Важно:** speech-to-text сейчас использует внешнюю OpenAI audio transcription API по серверному ключу. Это НЕ полностью офлайн голосовое решение; для локальной речи потребуется отдельный self-hosted STT сервис. Микрофон и колонка в заведении пока не подключены.

### Вторая ступень
Самостоятельная Ollama/llama.cpp-инференс-служба в изолированном контейнере (ресурсы и стоимость нужно определить), typed intent JSON schema, строгий проверяющий исполнитель и защита от prompt injection; локальный STT (например, Whisper на выделенной машине), TTS, диалоговые отчёты по заказам, длительная версионированная память, E2E проверки. Подмена локального модуля на LLM без валидации типов/ID и подтверждения **не допускается**.

## Понятные идентификаторы меню (октябрь 2026)

- По умолчанию в боте, Mini App и словаре владельца показывается **название позиции**. Для ингредиентов по умолчанию показывается название блюда и ингредиента: например `Сырная шаурма · сыр`.
- Псевдоним можно изменить отдельно от названия продукта: `Переименуй идентификатор сырной шаурмы в сырная`, `Переименуй идентификатор ингредиента сыр-лепешки в сыр-для-лепешки`. Также доступно редактирование в Mini App «Координатора» (действие «Переименовать обращение») и в настройках владельца «Идентификаторы меню».
- Внутренний ID объекта и служебный код `P...` / `I...` **не удаляются и не меняются** от переименования псевдонима. Это сохраняет связи с заказами, составами, подтверждениями и аудитом.
- Понятное имя хранится отдельно от меню, ограничено 2–80 символами, нормализуется по Unicode и регистру и должно быть уникальным в пределах заведения. Имя нельзя сделать равным идентификатору, названию или псевдониму другого объекта этого заведения. Совпадение имён при распознавании блокируется уточнением.
- «Удали ингредиент сыр-для-лепешки» находит уникальный псевдоним ингредиента, устанавливает принадлежность родительскому блюду и создаёт предложение об удалении только из его состава. «Убери сыр из сырной шаурмы» работает по имени блюда и ингредиента. После подтверждения применяется прежний проверенный исполнитель.
- Переименование псевдонима проходит через трёхминутное одноразовое подтверждение в боте; изменение в настройках владельца разрешено только авторизованному владельцу/менеджеру с правами меню и записывается в журнал действий.
- Вариации (острота, размер, топпинги) остаются поднастройками базовой позиции. При создании или переименовании блюда в другое уже существующее название операция отвергается. В заведении не создаются две разные основные позиции с одинаковыми названиями через Координатор.
- Прежний endpoint `set-code` оставлен только для совместимости старых интеграций, однако новый UI меняет `spoken_name` через `set-identifier`.
