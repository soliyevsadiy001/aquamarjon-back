import { Router } from "express";
import { db } from "../db.js";
import { env } from "../env.js";
import { requireTelegramInitData } from "../middleware/telegram.js";

export const notificationsRouter = Router();

// ⚠️ Эти ручки не используют requireAuth (Bearer/JWT) — их дёргают обычные
// покупатели (customer), которые не логинятся через /auth/login — тот флоу
// только для seller/courier/admin. Вместо этого — requireTelegramInitData
// ниже: проверяет HMAC-подпись Telegram WebApp initData, так что запрос
// действительно пришёл из вашего Mini App, а не откуда угодно с известным
// вам доменом (CORS сам по себе легко подделать вне браузера).
notificationsRouter.use("/notifications", requireTelegramInitData);

const NOTIF_TEXT: Record<string, (p: any) => string> = {
  water_reminder: () => "💧 Не забудьте поменять воду в аквариуме!",
  order_status: (p) => `📦 Статус вашего заказа изменился: ${p.status || "обновлён"}`,
  new_arrival: (p) => `🐠 Новое поступление: ${p.name || "новая рыбка"}!`,
  subscription_due: () => "🔁 Скоро автосписание по подписке на корм",
  badge_progress: (p) => `🏅 Новое достижение: ${p.title || ""}`,
  inactivity_reminder: () => "👋 Давно вас не было — заглядывайте в AquaMarjon!",
};

async function sendTelegramMessage(telegramId: string | number, text: string) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw Object.assign(new Error("TELEGRAM_BOT_TOKEN не задан"), { status: 503 });
  }
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: telegramId, text }),
  });
  if (!res.ok) throw Object.assign(new Error(`Telegram API ${res.status}`), { status: 502 });
}

notificationsRouter.post("/notifications/notify", async (req, res) => {
  const { telegram_id, type, payload } = req.body || {};
  if (!telegram_id || !type) return res.status(400).json({ error: "telegram_id и type обязательны" });

  const prefs = db.prepare(`SELECT * FROM notif_prefs WHERE telegram_id = ?`).get(String(telegram_id)) as any;
  // Если у пользователя ещё нет сохранённых настроек — считаем всё включённым по умолчанию.
  const category =
    type === "water_reminder" ? "water" : type === "order_status" ? "delivery" : "arrivals";
  if (prefs && prefs[category] === 0) {
    return res.json({ ok: true, skipped: "muted_by_prefs" });
  }

  const build = NOTIF_TEXT[type];
  if (!build) return res.status(400).json({ error: `Неизвестный тип уведомления: ${type}` });

  try {
    await sendTelegramMessage(telegram_id, build(payload || {}));
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[notifications/notify]", err);
    res.status(err?.status || 502).json({ error: "Не удалось отправить уведомление" });
  }
});

notificationsRouter.post("/notifications/preferences", (req, res) => {
  const { telegram_id, prefs } = req.body || {};
  if (!telegram_id || !prefs) return res.status(400).json({ error: "telegram_id и prefs обязательны" });
  db.prepare(
    `INSERT INTO notif_prefs (telegram_id, water, delivery, arrivals) VALUES (?, ?, ?, ?)
     ON CONFLICT(telegram_id) DO UPDATE SET water = excluded.water, delivery = excluded.delivery, arrivals = excluded.arrivals`
  ).run(String(telegram_id), prefs.water ? 1 : 0, prefs.delivery ? 1 : 0, prefs.arrivals ? 1 : 0);
  res.json({ ok: true });
});
