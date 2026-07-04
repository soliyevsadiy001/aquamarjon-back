import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { env } from "./env.js";
import { CATALOG_SEED } from "./catalog-seed.js";

const dir = path.dirname(env.DATABASE_PATH);
if (dir && dir !== "." && !fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

export const db = new Database(env.DATABASE_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id             TEXT PRIMARY KEY,
    role           TEXT NOT NULL CHECK (role IN ('seller','courier','admin')),
    name           TEXT NOT NULL,
    phone          TEXT NOT NULL,
    region         TEXT NOT NULL,
    login          TEXT NOT NULL,
    password_plain TEXT NOT NULL,
    password_hash  TEXT NOT NULL,
    temp_pass_plain TEXT,
    temp_pass_hash  TEXT,
    active         INTEGER NOT NULL DEFAULT 1,
    last_login     TEXT NOT NULL DEFAULT '—',
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_login_role ON accounts(login, role);

  CREATE TABLE IF NOT EXISTS promos (
    code          TEXT PRIMARY KEY,
    type          TEXT NOT NULL CHECK (type IN ('percent','fixed','free_delivery')),
    value         INTEGER NOT NULL DEFAULT 0,
    min_order_sum INTEGER,
    max_uses      INTEGER,
    uses          INTEGER NOT NULL DEFAULT 0,
    active        INTEGER NOT NULL DEFAULT 1,
    expires_at    TEXT
  );

  CREATE TABLE IF NOT EXISTS orders (
    id             TEXT PRIMARY KEY,
    phone          TEXT,
    region         TEXT,
    address        TEXT,
    comment        TEXT,
    delivery_slot  TEXT,
    pay_method     TEXT,
    promo_code     TEXT,
    promo_type     TEXT,
    items_json     TEXT NOT NULL,
    buyer_name     TEXT,
    telegram_id    TEXT,
    status         TEXT NOT NULL DEFAULT 'new',
    courier_name   TEXT NOT NULL DEFAULT '',
    note           TEXT NOT NULL DEFAULT '',
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notif_prefs (
    telegram_id TEXT PRIMARY KEY,
    water       INTEGER NOT NULL DEFAULT 1,
    delivery    INTEGER NOT NULL DEFAULT 1,
    arrivals    INTEGER NOT NULL DEFAULT 1
  );

  -- Каталог как источник истины по ценам (см. catalog-seed.ts) — вместо
  -- того, чтобы доверять цене, присланной клиентом в POST /orders.
  CREATE TABLE IF NOT EXISTS catalog (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    price      INTEGER NOT NULL,
    active     INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// На Railway уже может крутиться БД, созданная ДО того, как в orders
// появились courier_name/note (CREATE TABLE IF NOT EXISTS их не добавит —
// он молча не делает ничего, если таблица уже существует). Формальных
// миграций в проекте пока нет (см. тот же компромисс в adminAccounts.ts),
// поэтому чиним это точечно: пробуем добавить колонки и глотаем ошибку
// "duplicate column", если они уже есть (свежая БД, где CREATE TABLE выше
// их уже создал).
for (const stmt of [
  `ALTER TABLE orders ADD COLUMN courier_name TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE orders ADD COLUMN note TEXT NOT NULL DEFAULT ''`,
]) {
  try {
    db.exec(stmt);
  } catch {
    // колонка уже существует — ничего не делаем
  }
}

// Засеваем каталог при первом старте и обновляем название/цену для уже
// существующих id при каждом рестарте (источник правды — catalog-seed.ts,
// пока не появится админский CRUD поверх этой таблицы). Новые строки,
// добавленные вручную в БД (например, будущим админ-CRUD), не трогаем —
// ON CONFLICT обновляет только те id, что реально перечислены в сиде.
const upsertCatalogItem = db.prepare(`
  INSERT INTO catalog (id, name, price, active, updated_at)
  VALUES (?, ?, ?, 1, datetime('now'))
  ON CONFLICT(id) DO UPDATE SET name = excluded.name, price = excluded.price, updated_at = datetime('now')
`);
const seedCatalog = db.transaction(() => {
  for (const item of CATALOG_SEED) {
    upsertCatalogItem.run(item.id, item.name, item.price);
  }
});
seedCatalog();
