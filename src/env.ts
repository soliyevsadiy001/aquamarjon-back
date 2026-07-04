import "dotenv/config";

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") {
    throw new Error(`[env] Отсутствует обязательная переменная окружения: ${name}`);
  }
  return v;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

// @types/jsonwebtoken@9.0.7 требует, чтобы expiresIn было числом (секунды)
// или "брендированной" строкой формата "30d" из пакета ms — обычный
// string из переменной окружения этому типу не удовлетворяет. Чтобы не
// городить as unknown as касты (которые ничего не гарантируют в рантайме),
// парсим значение в секунды один раз здесь.
function parseExpiresInSeconds(name: string, fallback: string): number {
  const raw = process.env[name] ?? fallback;
  const asNumber = Number(raw);
  if (!Number.isNaN(asNumber) && raw.trim() !== "") return asNumber;

  const match = /^(\d+)\s*(s|m|h|d|w|y)$/i.exec(raw.trim());
  if (!match) {
    throw new Error(
      `[env] Некорректный формат ${name}="${raw}". Ожидается число секунд или "30d"/"12h"/"15m" и т.п.`
    );
  }
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
    w: 604800,
    y: 31536000,
  };
  return amount * multipliers[unit];
}

export const env = {
  PORT: Number(optional("PORT", "8080")),
  CORS_ORIGIN: optional("CORS_ORIGIN", "*"),
  DATABASE_PATH: optional("DATABASE_PATH", "./data/aquamarjon.sqlite3"),

  // JWT_SECRET обязателен всегда — без него сервер вообще не стартует,
  // чтобы случайно не уйти в прод с дефолтным секретом.
  JWT_SECRET: required("JWT_SECRET"),
  // Секунды (число), а не строка "30d" — см. parseExpiresInSeconds выше.
  JWT_EXPIRES_IN: parseExpiresInSeconds("JWT_EXPIRES_IN", "30d"),

  ADMIN_SEED_LOGIN: optional("ADMIN_SEED_LOGIN"),
  ADMIN_SEED_PASSWORD: optional("ADMIN_SEED_PASSWORD"),
  ADMIN_SEED_NAME: optional("ADMIN_SEED_NAME", "Владелец"),
  ADMIN_SEED_PHONE: optional("ADMIN_SEED_PHONE"),

  // Эти два — не required(): без них /ai/* и /support/request просто
  // отвечают 503 с понятной ошибкой (см. routes/ai.ts, routes/support.ts),
  // а не роняют весь сервер при старте. Так бэкенд можно поднять и
  // потестировать остальное (логин, каталог, заказы), даже пока ключи
  // ещё не заведены.
  ANTHROPIC_API_KEY: optional("ANTHROPIC_API_KEY"),
  ANTHROPIC_MODEL: optional("ANTHROPIC_MODEL", "claude-sonnet-4-5"),

  TELEGRAM_BOT_TOKEN: optional("TELEGRAM_BOT_TOKEN"),
  TELEGRAM_SUPPORT_CHAT_ID: optional("TELEGRAM_SUPPORT_CHAT_ID"),
};

if (env.JWT_SECRET === "change-me-to-a-long-random-string") {
  throw new Error(
    "[env] JWT_SECRET всё ещё дефолтный из .env.example — сгенерируйте свой (openssl rand -hex 32) перед запуском."
  );
}
