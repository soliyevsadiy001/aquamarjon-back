import type { NextFunction, Request, Response } from "express";
import crypto from "node:crypto";
import { env } from "../env.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      telegramUserId?: string;
    }
  }
}

const MAX_INIT_DATA_AGE_SEC = 24 * 60 * 60; // 24 часа — стандартная рекомендация Telegram

/**
 * Проверяет подпись Telegram WebApp initData по алгоритму из доков:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * secret_key = HMAC_SHA256(bot_token, "WebAppData")
 * data_check_string = все поля кроме hash, отсортированные по ключу, "key=value" через \n
 * ожидаемый hash = HMAC_SHA256(data_check_string, secret_key) в hex
 */
function verifyInitData(initData: string, botToken: string): { ok: true; userId?: string } | { ok: false; reason: string } {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, reason: "INIT_DATA_UNPARSEABLE" };
  }

  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "INIT_DATA_NO_HASH" };
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const computedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  // timingSafeEqual требует одинаковой длины буферов — hash из Telegram
  // всегда hex(sha256) = 64 символа, но на случай кривого клиента страхуемся.
  const a = Buffer.from(computedHash, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "INIT_DATA_BAD_SIGNATURE" };
  }

  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Date.now() / 1000 - authDate > MAX_INIT_DATA_AGE_SEC) {
    return { ok: false, reason: "INIT_DATA_EXPIRED" };
  }

  let userId: string | undefined;
  const userRaw = params.get("user");
  if (userRaw) {
    try {
      userId = String(JSON.parse(userRaw).id ?? "");
    } catch {
      // необязательное поле — не блокируем из-за кривого user JSON
    }
  }

  return { ok: true, userId };
}

/**
 * Требует валидный Telegram initData в заголовке X-Telegram-Init-Data —
 * вешается на customer-facing ручки (/notifications/*, /promos/validate),
 * которые раньше не проверяли вообще ничего, кроме CORS (см. README,
 * "Дальнейшее укрепление" → "Валидация Telegram initData").
 *
 * Поведение в зависимости от окружения:
 * - TELEGRAM_BOT_TOKEN не задан (например, локальная разработка без бота
 *   или ранние стадии деплоя) — пропускаем с предупреждением в лог, чтобы
 *   не блокировать разработку/тестирование остального функционала.
 * - TELEGRAM_BOT_TOKEN задан (прод) — обязательна валидная подпись,
 *   иначе 401. Это осознанно строже, чем раньше: если бот настроен, значит
 *   мы ожидаем реальный Mini App трафик, а не голые fetch с чужого домена.
 */
export function requireTelegramInitData(req: Request, res: Response, next: NextFunction) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    console.warn(
      "[telegram initData] TELEGRAM_BOT_TOKEN не задан — пропускаю запрос без проверки подписи. " +
        "Не оставляйте так в проде, см. README."
    );
    return next();
  }

  const initData = String(req.headers["x-telegram-init-data"] || "");
  if (!initData) {
    return res.status(401).json({ error: "TELEGRAM_INIT_DATA_REQUIRED" });
  }

  const result = verifyInitData(initData, env.TELEGRAM_BOT_TOKEN);
  if (!result.ok) {
    return res.status(401).json({ error: result.reason });
  }

  req.telegramUserId = result.userId;
  next();
}
