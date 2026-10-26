# Shaurmeg V3 · единый Mini App

V3 подготовлен отдельно в ветке `release/v3-unified-miniapp-20261026`. Рабочую ветку `main` и действующие Telegram webhooks V2 не трогать.

## Состав

- Один Node.js web service: `v2/backend/src/server.js`, со статическими файлами `v2/frontend/` на том же origin.
- Пользовательский Telegram-бот: карта, поиск, меню, конструкторы, избранное, заказы, быстрые заказы, статусы, RealCity.
- Один административный Telegram-бот: вход в `/admin-unified.html`, суперадмин (карта/заведения), владелец (меню/заказы/оформление), сообщения для управления меню и кухня/статусы.
- Telegram initData по-прежнему проверяется криптографически на сервере. Право суперадмина задаётся `ADMIN_TELEGRAM_IDS`; доступ владельца ограничен конкретным заведением.
- Все данные V3 должны быть в **отдельной** PostgreSQL; `DATABASE_URL` от работающего V2 категорически не использовать для тестового запуска.

## Render: отдельный web service

Новый repository от V2, ветка `main` новой копии (сначала перенести всю эту релизную ветку):

- Runtime: Node.js 22
- Root: repository root
- Build command: `npm --prefix backend install --ignore-scripts && npm --prefix v2/backend install --ignore-scripts`
- Start command: `node v2/backend/src/server.js`
- Health check path: `/api/v2/health`
- Env: `V3_UNIFIED_MODE=true`, `V3_USER_BOT_TOKEN`, `V3_ADMIN_BOT_TOKEN`, `V3_USER_BOT_USERNAME`, `ADMIN_TELEGRAM_IDS`, `DATABASE_URL` (новая БД), `V3_PUBLIC_URL` (не обязателен на Render при наличии `RENDER_EXTERNAL_URL`).
- Для отсутствия внешней оплаты оставить платёжные ключи незаполненными.

**Не переносить** ключи V2, например `AGGREGATOR_TELEGRAM_BOT_TOKEN`, `KITCHEN_TELEGRAM_BOT_TOKEN`, `VENUE_OWNER_TELEGRAM_BOT_TOKEN`, `ADMIN_TELEGRAM_BOT_TOKEN`. Они автоматически игнорируются в unified mode.

## Публикация

1. Проверить GitHub Actions `v3-validate`.
2. Создать новую приватную репозиторию V3, **не сливая V3 в V2 main**.
3. Создать новый Render PostgreSQL; подключить независимый `DATABASE_URL`.
4. Создать новый Render Web Service (две Telegram-идентичности в env, не в коде).
5. Проверить `GET /api/v2/health`: статус 200, `architecture: "unified-v3"`, `database: true`, оба бота `true`. Проверить `GET /index.html` и `GET /admin-unified.html`.
6. Проверить, что Telegram webhook user идёт на `/api/v2/telegram/aggregator`, admin — на `/api/v2/telegram/kitchen`; запросы без подписанного Telegram secret header возвращают 403.
7. Провести E2E-тест с тестовым заведением и тестовыми пользователями. **Не менять production webhooks V2**.
8. Миграцию данных из V2 выполнять только после резервного копирования PostgreSQL, сравнения таблиц, количества строк, ключей и выборочной проверки заказов/избранного/меню/RealCity. Без этого V3 в пустой БД открывается как новый каталог.

## Почему один Render-сервис

Веб-клиент, API и admin hub имеют один origin. `v2/frontend/config.js` обращается к `location.origin + "/api/v2"`, а не к текущему V2. Telegram credentials не отправляются в браузер; только проверяемый `initData` используется для авторизации.

## Текущие ограничения

Создание новой GitHub-репозитории и Render-сервисов требует доступных операций приложения GitHub/Render и подтверждённого Render workspace; релизная ветка — промежуточный исходник, **не production публикация**.
