import { Router } from "express";
import { db } from "../db.js";
import { requireTelegramInitData } from "../middleware/telegram.js";

export const promosRouter = Router();

// См. комментарий в routes/notifications.ts — та же логика: покупатели тут
// не логинятся через /auth/login, поэтому вместо Bearer-токена проверяем
// подпись Telegram initData.
promosRouter.use("/promos", requireTelegramInitData);

function catalogPriceOf(id: string): number | null {
  const row = db.prepare(`SELECT price FROM catalog WHERE id = ? AND active = 1`).get(id) as
    | { price: number }
    | undefined;
  return row ? row.price : null;
}

promosRouter.post("/promos/validate", (req, res) => {
  const { code, cart_total, items } = req.body || {};
  if (!code) return res.status(400).json({ error: "PROMO_NOT_FOUND" });

  const promo = db
    .prepare(`SELECT * FROM promos WHERE code = ?`)
    .get(String(code).trim().toUpperCase()) as any;

  if (!promo) return res.status(404).json({ error: "PROMO_NOT_FOUND" });
  if (!promo.active) return res.status(410).json({ error: "PROMO_LIMIT_REACHED" });
  if (promo.expires_at && new Date(promo.expires_at).getTime() < Date.now()) {
    return res.status(410).json({ error: "PROMO_EXPIRED" });
  }
  if (promo.max_uses != null && promo.uses >= promo.max_uses) {
    return res.status(410).json({ error: "PROMO_LIMIT_REACHED" });
  }

  // ⚠️ Раньше min_order_sum сверялся только с cart_total, присланным
  // клиентом, — то есть можно было прислать завышенный cart_total, пройти
  // проверку минимальной суммы, а по факту оформить заказ на меньшую сумму
  // (см. POST /orders — там своя, независимая проверка цен по каталогу, но
  // применение промокода в CheckoutScreen решается по ответу отсюда).
  // Если фронт прислал `items` — пересчитываем сумму по каталожным ценам и
  // доверяем этому пересчёту, а не голому cart_total. Если `items` нет
  // (старый клиент/переходный период) — используем cart_total как раньше,
  // это не хуже прежнего поведения.
  let effectiveTotal = Number(cart_total || 0);
  if (Array.isArray(items) && items.length > 0) {
    let recomputed = 0;
    let sawKnownItem = false;
    for (const raw of items) {
      const item = raw as any;
      if (!item || typeof item.id !== "string") continue;
      const qty = Number(item.qty) > 0 ? Number(item.qty) : 1;
      const catalogPrice = catalogPriceOf(item.id);
      if (catalogPrice != null) {
        recomputed += catalogPrice * qty;
        sawKnownItem = true;
      } else if (typeof item.price === "number" && Number.isFinite(item.price)) {
        // id не в каталоге (переходный период) — считаем по присланной цене,
        // как и раньше, не блокируем.
        recomputed += item.price * qty;
      }
    }
    if (sawKnownItem) effectiveTotal = recomputed;
  }

  if (promo.min_order_sum != null && effectiveTotal < promo.min_order_sum) {
    return res.status(400).json({ error: "PROMO_MIN_ORDER" });
  }

  // Использование (uses++) фиксируется при оформлении заказа (POST /orders),
  // а не здесь — validate можно дёргать многократно, пока пользователь
  // печатает код, это не должно расходовать лимит промокода.
  res.json({ type: promo.type, value: promo.value });
});
