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

export const env = {
  PORT: Number(optional("PORT", "8080")),
  CORS_ORIGIN: optional("CORS_ORIGIN", "*"),
  DATABASE_PATH: optional("DATABASE_PATH", "./data/aquamarjon.sqlite3"),

  // JWT_SECRET обязателен всегда — без него сервер вообще не стартует,
  // чтобы случайно не уйти в прод с дефолтным секретом.
  JWT_SECRET: required("JWT_SECRET"),
  JWT_EXPIRES_IN: optional("JWT_EXPIRES_IN", "30d"),

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
