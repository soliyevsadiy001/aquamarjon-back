import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * src/env.ts падает при импорте, если не задан JWT_SECRET, а src/db.ts при
 * импорте сразу открывает файл БД и применяет схему — то есть env-переменные
 * обязаны быть выставлены ДО первого `import("../src/app.js")` в тестовом
 * файле. Поэтому это не React-хук и не beforeAll, а обычная функция, которую
 * тестовый файл вызывает первой строкой, синхронно, до любых импортов
 * из src/*.
 *
 * Каждый тестовый файл получает свой файл БД (см. isolate: true в
 * vitest.config.ts — у каждого тестового файла свой модульный реестр, так
 * что переустановка process.env здесь не протекает в другие файлы) —
 * это дешевле и надёжнее, чем чистить таблицы между тестами внутри файла.
 */
export function setupTestEnv(suiteName: string) {
  const dbPath = path.join(
    os.tmpdir(),
    `aquamarjon-test-${suiteName}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite3`
  );

  process.env.JWT_SECRET = "test-only-secret-do-not-use-in-prod";
  process.env.JWT_EXPIRES_IN = "1h";
  process.env.DATABASE_PATH = dbPath;
  process.env.CORS_ORIGIN = "*";
  process.env.PORT = "0";
  // Намеренно не заданы: TELEGRAM_BOT_TOKEN, ANTHROPIC_API_KEY — оба
  // опциональны (см. env.ts), а без TELEGRAM_BOT_TOKEN
  // requireTelegramInitData пропускает запросы без проверки подписи, что
  // упрощает тесты /promos и /notifications (см. middleware/telegram.ts).
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ADMIN_SEED_LOGIN;
  delete process.env.ADMIN_SEED_PASSWORD;

  return {
    dbPath,
    cleanup() {
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          fs.unlinkSync(dbPath + suffix);
        } catch {
          // файла может не быть — не страшно
        }
      }
    },
  };
}
