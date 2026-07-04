import { Router } from "express";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const ordersRouter = Router();

// Статусы, которые реально умеет показывать фронт (см. data/orders.ts
// ORDER_STATUS_FLOW/NEXT_STATUS и data/admin-seed.ts ADMIN_SC на фронте).
// "new" — заказ только что создан покупателем (см. POST /orders ниже),
// дальше им управляют продавец/админ/курьер через PATCH /orders/:id/status.
const VALID_STATUSES = new Set(["new", "accepted", "packed", "courier", "way", "delivered", "cancelled"]);

interface OrderRow {
  id: string;
  phone: string;
  region: string;
  address: string;
  comment: string;
  delivery_slot: string;
  pay_method: string;
  promo_code: string | null;
  promo_type: string | null;
  items_json: string;
  buyer_name: string;
  telegram_id: string | null;
  status: string;
  courier_name: string;
  note: string;
  created_at: string;
}

/** Форма, в которой заказ уходит на фронт — единая для админки/продавца/
 *  курьера (см. lib/orders-map.ts на фронте, который раскладывает это в
 *  формы, ожидаемые конкретными экранами: AdminOrdersTab, SellerCabinet,
 *  CourierView). */
function toOrderDTO(row: OrderRow) {
  let items: unknown[] = [];
  try {
    items = JSON.parse(row.items_json);
  } catch {
    items = [];
  }
  return {
    id: row.id,
    phone: row.phone,
    region: row.region,
    address: row.address,
    comment: row.comment,
    delivery_slot: row.delivery_slot,
    pay_method: row.pay_method,
    promo_code: row.promo_code,
    promo_type: row.promo_type,
    items,
    buyer_name: row.buyer_name,
    telegram_id: row.telegram_id,
    status: row.status,
    courier_name: row.courier_name || "",
    note: row.note || "",
    created_at: row.created_at,
  };
}

// ⚠️ Каталог теперь есть на бэкенде (таблица `catalog`, см. db.ts +
// catalog-seed.ts) и используется как источник истины по ценам — это
// закрывает основную дыру, которая была раньше ("любой человек с devtools
// мог отправить заказ по своей цене").
//
// Ограничение текущей реализации: сид пока покрывает только БАЗОВЫЕ цены
// (id -> price из FISH_DB_BASE/products.ts), без системы вариантов
// (CatalogOverrides во фронтовом data/fish.ts — окрас/размер меняют цену
// относительно базовой). Поэтому проверка ниже не требует ТОЧНОГО
// совпадения цены, а допускает отклонение в пределах PRICE_TOLERANCE в
// БОЛЬШУЮ сторону (вариант дороже базовой рыбки — нормально) и запрещает
// уходить более чем на PRICE_TOLERANCE ниже базовой цены (а вот занижать
// цену — как раз то, от чего защищаемся). Для id, которых нет в каталоге
// (например, будущие бандлы/акции, которых сид ещё не знает) — оставлен
// прежний структурный fail-safe, чтобы не блокировать заказы вслепую;
// это осознанный компромисс переходного периода, см. README.
const MAX_ITEM_PRICE = 50_000_000; // сум — с запасом выше любой реальной позиции каталога
const MAX_ORDER_ITEMS = 200;
const PRICE_TOLERANCE = 0.15; // ±15% от каталожной цены — запас под варианты/акции

function getCatalogPrice(id: string): number | null {
  const row = db.prepare(`SELECT price FROM catalog WHERE id = ? AND active = 1`).get(id) as
    | { price: number }
    | undefined;
  return row ? row.price : null;
}

function validateItems(items: unknown[]): string | null {
  if (items.length > MAX_ORDER_ITEMS) return "Слишком много позиций в заказе";
  for (const raw of items) {
    const item = raw as any;
    if (!item || typeof item !== "object") return "Некорректная позиция в корзине";
    if (typeof item.id !== "string" || !item.id.trim()) return "У позиции в корзине нет id";
    if (typeof item.name !== "string" || !item.name.trim()) return "У позиции в корзине нет названия";
    if (typeof item.price !== "number" || !Number.isFinite(item.price) || item.price < 0) {
      return `Некорректная цена у позиции "${item.name || item.id}"`;
    }
    if (item.price > MAX_ITEM_PRICE) {
      return `Слишком большая цена у позиции "${item.name || item.id}"`;
    }

    const catalogPrice = getCatalogPrice(item.id);
    if (catalogPrice != null) {
      const minAllowed = catalogPrice * (1 - PRICE_TOLERANCE);
      if (item.price < minAllowed) {
        return `Цена позиции "${item.name || item.id}" не совпадает с каталогом (прислано ${item.price}, ожидалось от ${Math.round(minAllowed)})`;
      }
    }
    // Если id нет в catalog — пропускаем (переходный период, см. комментарий выше).
  }
  return null;
}

ordersRouter.post("/orders", (req, res) => {
  const {
    phone, region, address, comment, delivery_slot, pay_method,
    promo_code, promo_type, items, buyer_name, telegram_user,
  } = req.body || {};

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Корзина пуста" });
  }

  const itemsError = validateItems(items);
  if (itemsError) return res.status(400).json({ error: itemsError });

  const id = `ord_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const insert = db.transaction(() => {
    db.prepare(
      `INSERT INTO orders (id, phone, region, address, comment, delivery_slot, pay_method, promo_code, promo_type, items_json, buyer_name, telegram_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')`
    ).run(
      id, phone || "", region || "", address || "", comment || "", delivery_slot || "",
      pay_method || "", promo_code || null, promo_type || null,
      JSON.stringify(items), buyer_name || "", telegram_user?.id ? String(telegram_user.id) : null
    );

    // Списываем использование промокода только сейчас, когда заказ реально
    // оформлен — validate (см. routes/promos.ts) это намеренно не делает.
    if (promo_code) {
      db.prepare(`UPDATE promos SET uses = uses + 1 WHERE code = ?`).run(String(promo_code).toUpperCase());
    }
  });

  try {
    insert();
    res.status(201).json({ order_id: id });
  } catch (err) {
    console.error("[orders]", err);
    res.status(500).json({ error: "Не удалось сохранить заказ" });
  }
});

// ── Чтение и смена статуса заказов (админка / продавец / курьер) ──────
//
// Раньше AdminOrdersTab, SellerCabinet и CourierView жили на локальных
// демо-данных (data/orders.ts, data/admin-seed.ts, data/seller-seed.ts,
// data/demo-deliveries.ts) и ничего не знали о заказах, реально попавших
// в БД через POST /orders выше. Теперь у них есть настоящий источник
// правды: GET /orders (с фильтрацией по роли) и три точечные ручки на
// изменение заказа. Маппинг ответа под конкретный экран (какие поля
// нужны AdminOrdersTab/SellerOrderRow/CourierView) сделан на фронте, см.
// lib/orders-map.ts — здесь отдаётся один универсальный DTO (toOrderDTO).

ordersRouter.get("/orders", requireAuth, (req, res) => {
  const role = req.user!.role;

  if (role === "admin" || role === "seller") {
    // У продавца пока нет привязки к конкретным заказам (в проекте один
    // магазин, не мультивендор) — он, как и админ, видит все заказы.
    const rows = db.prepare(`SELECT * FROM orders ORDER BY created_at DESC`).all() as OrderRow[];
    return res.json(rows.map(toOrderDTO));
  }

  if (role === "courier") {
    // Назначение курьера на заказ (см. POST /orders/:id/assign-courier
    // ниже) хранится по имени, а не по account id — так исторически
    // устроен список курьеров в админке (ADMIN_INIT_COURIERS собирается
    // из data/regions.ts, а не из таблицы accounts). Поэтому здесь мы
    // сверяем courier_name заказа с именем аккаунта из токена.
    const acc = db.prepare(`SELECT name FROM accounts WHERE id = ?`).get(req.user!.id) as
      | { name: string }
      | undefined;
    const rows = db
      .prepare(`SELECT * FROM orders WHERE courier_name = ? ORDER BY created_at DESC`)
      .all(acc?.name || "\0") as OrderRow[];
    return res.json(rows.map(toOrderDTO));
  }

  return res.status(403).json({ error: "FORBIDDEN" });
});

function loadOrderOr404(id: string, res: import("express").Response): OrderRow | null {
  const row = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id) as OrderRow | undefined;
  if (!row) {
    res.status(404).json({ error: "Заказ не найден" });
    return null;
  }
  return row;
}

ordersRouter.patch("/orders/:id/status", requireAuth, requireRole("admin", "seller", "courier"), (req, res) => {
  const { status } = req.body || {};
  if (typeof status !== "string" || !VALID_STATUSES.has(status)) {
    return res.status(400).json({ error: "Недопустимый статус" });
  }

  const row = loadOrderOr404(req.params.id, res);
  if (!row) return;

  if (req.user!.role === "courier") {
    const acc = db.prepare(`SELECT name FROM accounts WHERE id = ?`).get(req.user!.id) as
      | { name: string }
      | undefined;
    if (!acc || row.courier_name !== acc.name) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }
  }

  db.prepare(`UPDATE orders SET status = ? WHERE id = ?`).run(status, row.id);
  const updated = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(row.id) as OrderRow;
  res.json(toOrderDTO(updated));
});

// Назначение курьера — только админ (у продавца в текущей модели нет
// своего пула курьеров, назначение всегда идёт через админку, см.
// AdminOrdersTab). courierName — свободный текст, а не id: список
// курьеров в админке до сих пор не привязан к accounts (см. комментарий
// в GET /orders выше про ADMIN_INIT_COURIERS).
ordersRouter.post("/orders/:id/assign-courier", requireAuth, requireRole("admin"), (req, res) => {
  const { courierName } = req.body || {};
  if (typeof courierName !== "string") {
    return res.status(400).json({ error: "courierName обязателен" });
  }
  const row = loadOrderOr404(req.params.id, res);
  if (!row) return;

  db.prepare(`UPDATE orders SET courier_name = ? WHERE id = ?`).run(courierName, row.id);
  const updated = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(row.id) as OrderRow;
  res.json(toOrderDTO(updated));
});

ordersRouter.patch("/orders/:id/note", requireAuth, requireRole("admin", "seller"), (req, res) => {
  const { note } = req.body || {};
  if (typeof note !== "string") {
    return res.status(400).json({ error: "note обязателен (может быть пустой строкой)" });
  }
  const row = loadOrderOr404(req.params.id, res);
  if (!row) return;

  db.prepare(`UPDATE orders SET note = ? WHERE id = ?`).run(note, row.id);
  const updated = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(row.id) as OrderRow;
  res.json(toOrderDTO(updated));
});
