# AquaMarjon — backend (MVP)

Реализует ровно те эндпоинты, которые уже дёргает фронтенд (`src/lib/api.ts`,
`notify.ts`, `promo.ts`, `LoginScreen.tsx`, `Checkout.tsx`) — закрывает
блокер "8 функций в api.ts падают, бэкенда нет".

Стек: Node + TypeScript + Express + SQLite (better-sqlite3). SQLite выбран
осознанно для MVP: ноль внешней инфраструктуры, поднимается на Railway с
одним volume, для нагрузки одного города/страны в старте более чем
достаточно. Когда понадобится — миграция на Postgres локализована в
`src/db.ts` (одна точка входа ко всем запросам).

## Быстрый старт

```bash
npm install
cp .env.example .env      # заполните JWT_SECRET, ADMIN_SEED_*, и т.д.
npm run seed:admin        # создаёт первого admin-аккаунта из ADMIN_SEED_*
npm run dev                # http://localhost:8080
```

Проверка: `curl http://localhost:8080/health` → `{"ok":true,"db":true}`
(`/health` реально дёргает SQLite через `SELECT 1`, а не просто отвечает
статикой — если volume на Railway не примонтирован или файл БД повреждён,
ручка вернёт 503, а не тихий "ok").

## Тесты

```bash
npm test           # разовый прогон (vitest run)
npm run test:watch # вотч-режим для разработки
```

Тесты гоняют `src/app.ts` через `supertest` на изолированной временной
SQLite-базе на файл теста — реальный порт/сеть не нужны. Покрыты
бизнес-критичные вещи: `/auth/login` и `/auth/change-password`, защита
`/orders` от подмены цены и от чужих ролей/чужих заказов, защита
`/promos/validate` от завышения `cart_total` мимо каталожных цен. Остальные
роуты (`/admin/accounts`, `/notifications`, `/support`, `/ai`) тестами пока
не покрыты — следующий кандидат на расширение.

## CI

`.github/workflows/ci.yml` на каждый push/PR в `main` гоняет `typecheck`
(отдельно для `src` и для `tests`), `test` и `build`.

## Деплой на Railway

1. Новый проект → Deploy from repo (этот каталог как корень сервиса).
2. Добавьте volume, примонтируйте на `/data`, выставьте `DATABASE_PATH=/data/aquamarjon.sqlite3` —
   иначе SQLite-файл будет пересоздаваться при каждом деплое и все аккаунты/заказы потеряются.
3. Задайте переменные окружения из `.env.example` (Railway → Variables).
4. Build command: `npm run build`, Start command: `npm start`.
5. Один раз выполните `npm run seed:admin` (Railway → Shell) — создаёт первого админа.
6. На фронте пропишите `VITE_API_URL=https://<ваш-сервис>.up.railway.app` в `.env.local`.

## Эндпоинты

| Метод | Путь | Auth | Назначение |
|---|---|---|---|
| POST | `/auth/login` | — | Логин seller/courier/admin, выдаёт JWT |
| POST | `/auth/change-password` | Bearer | Смена своего пароля (после входа по temp-паролю) |
| GET | `/admin/accounts` | Bearer admin | Список аккаунтов |
| POST | `/admin/accounts` | Bearer admin | Создать аккаунт |
| PATCH | `/admin/accounts/:id` | Bearer admin | Изменить поле аккаунта |
| POST | `/admin/accounts/:id/toggle` | Bearer admin | Заблокировать/разблокировать |
| DELETE | `/admin/accounts/:id` | Bearer admin | Удалить аккаунт |
| POST | `/admin/accounts/:id/reset-password` | Bearer admin | Сгенерировать временный пароль |
| POST | `/ai/chat` | — | Прокси в Anthropic (чат-бот Marjon) |
| POST | `/ai/diagnose` | — | Прокси в Anthropic (AI-диагностика в Докторе) |
| POST | `/support/request` | — | Заявка "Нет доступа" → Telegram-сообщение вам |
| POST | `/notifications/notify` | Telegram initData | Push через Telegram-бота |
| POST | `/notifications/preferences` | Telegram initData | Сохранить настройки уведомлений пользователя |
| POST | `/promos/validate` | Telegram initData | Проверить промокод |
| POST | `/orders` | — | Создать заказ |
| GET | `/orders` | Bearer admin/seller/courier | Список заказов (courier видит только свои назначенные) |
| PATCH | `/orders/:id/status` | Bearer admin/seller/courier | Сменить статус заказа |
| POST | `/orders/:id/assign-courier` | Bearer admin | Назначить курьера на заказ (по имени) |
| PATCH | `/orders/:id/note` | Bearer admin/seller | Сохранить заметку к заказу |
| GET | `/catalog` | — | Список id/название/цена — источник истины по ценам |

Точные форматы запроса/ответа — см. соответствующий файл в `src/routes/`,
каждый написан 1:1 под то, что реально шлёт фронтенд (см. комментарии
"⚠️ ВАЖНО" в `src/lib/api.ts` фронтенда — оттуда и взяты контракты).

## Осознанные компромиссы MVP (что ещё не полностью закрыто)

- **`POST /orders` проверяет цены по каталогу, но не на 100%.** С этой
  версии в БД есть таблица `catalog` (см. `src/catalog-seed.ts`,
  засеяна из фронтового `FISH_DB_BASE`/`products.ts`), и `validateItems()`
  сверяет присланную цену с каталожной (допуская ±15% под варианты/акции —
  система вариантов `CatalogOverrides` с фронта пока не перенесена целиком).
  Для id, которых ещё нет в каталоге, остаётся прежний структурный
  fail-safe. Следующий шаг — перенести и систему вариантов, чтобы допуск
  можно было убрать совсем.
- **`accounts.password_plain`**: пароли продавцов/курьеров больше НЕ
  хранятся постоянно открытым текстом. Плейнтекст возвращается ровно один
  раз — в ответе `POST /admin/accounts` (создание) — и сразу же зануляется
  в БД. Дальнейшая смена пароля возможна только через
  `POST /admin/accounts/:id/reset-password` (тоже одноразовый показ,
  `tempPass`). `PATCH .../accounts/:id` с `field: "password"` теперь
  отклоняется явной ошибкой.
- **`/notifications/*` и `/promos/validate`** теперь защищены проверкой
  Telegram `initData` (HMAC подписью бота, см. `src/middleware/telegram.ts`) —
  фронт передаёт его в заголовке `X-Telegram-Init-Data`. Если
  `TELEGRAM_BOT_TOKEN` не задан (например, локальная разработка), проверка
  мягко пропускается с предупреждением в лог — не забудьте задать токен
  в проде, иначе защиты снова не будет.

## Дальнейшее укрепление (не блокер запуска, но полезно)

1. **Система вариантов каталога (`CatalogOverrides`)** — сейчас на бэкенде
   есть только базовые id/цены (`catalog-seed.ts`); окрас/размер/акционные
   цены с фронтового `localStorage` ещё не перенесены, отсюда допуск ±15%
   в `validateItems()`. Как только появится админский CRUD над `catalog` —
   можно убрать допуск и сверять цену точно.
2. **Курьеры в админке не привязаны к `accounts`.** Список курьеров
   (`ADMIN_INIT_COURIERS` на фронте) до сих пор генерируется из
   `data/regions.ts`, а не из таблицы `accounts` — поэтому назначение
   курьера на заказ (`POST /orders/:id/assign-courier`) хранит свободное
   имя (`courier_name`), а не `account_id`, и курьер видит свои заказы по
   совпадению имени аккаунта, а не по стабильному id (см. `GET /orders`
   в `src/routes/orders.ts`). Следующий шаг — завести курьеров как
   `accounts` с `role: "courier"` и переключить назначение на id.
3. **Sentry на бэкенде** — на фронте уже подключён (`src/lib/sentry.ts`);
   на бэкенде пока только `console.error`, для прод-логов Railway этого
   хватает для старта, но `@sentry/node` — следующий логичный шаг.
