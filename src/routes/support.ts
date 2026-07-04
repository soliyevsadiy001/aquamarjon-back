import { Router } from "express";
import rateLimit from "express-rate-limit";
import { env } from "../env.js";

export const supportRouter = Router();

const supportLimiter = rateLimit({ windowMs: 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false });

supportRouter.post("/support/request", supportLimiter, async (req, res) => {
  const { role, name, username, userId, message } = req.body || {};
  if (!message) return res.status(400).json({ error: "message обязателен" });

  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_SUPPORT_CHAT_ID) {
    console.error("[support/request] TELEGRAM_BOT_TOKEN/TELEGRAM_SUPPORT_CHAT_ID не заданы");
    return res.status(503).json({ error: "Служба поддержки временно недоступна" });
  }

  const text =
    `🆘 Заявка "Нет доступа"\n` +
    `Роль: ${role || "—"}\n` +
    `Имя: ${name || "—"}\n` +
    `Username: ${username ? "@" + username : "—"}\n` +
    `Telegram ID: ${userId ?? "—"}\n\n` +
    `${message}`;

  try {
    const tgRes = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: env.TELEGRAM_SUPPORT_CHAT_ID, text }),
      }
    );
    if (!tgRes.ok) throw new Error(`Telegram API ${tgRes.status}`);
    res.json({ ok: true });
  } catch (err) {
    console.error("[support/request]", err);
    res.status(502).json({ error: "Не удалось отправить заявку, попробуйте позже" });
  }
});
