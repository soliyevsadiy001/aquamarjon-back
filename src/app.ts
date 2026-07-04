import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { env } from "./env.js";
import { db } from "./db.js"; // применяет схему при старте
import { authRouter } from "./routes/auth.js";
import { adminAccountsRouter } from "./routes/adminAccounts.js";
import { aiRouter } from "./routes/ai.js";
import { supportRouter } from "./routes/support.js";
import { notificationsRouter } from "./routes/notifications.js";
import { promosRouter } from "./routes/promos.js";
import { ordersRouter } from "./routes/orders.js";
import { catalogRouter } from "./routes/catalog.js";

// Сборка приложения вынесена из server.ts в отдельный модуль, который не
// вызывает app.listen(). server.ts (реальный вход процесса) импортирует
// app отсюда и слушает порт; тесты (см. tests/) импортируют app напрямую и
// гоняют запросы через supertest, не занимая реальный TCP-порт и не завися
// от таймингов старта сервера.
export const app = express();

app.use(
  cors({
    origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(",").map((s) => s.trim()),
  })
);
app.use(express.json({ limit: "1mb" }));

// Общий лимит на весь API поверх точечных лимитов на /auth/login и /ai/*
// (см. соответствующие роутеры) — защита от совсем грубого флуда.
app.use(rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false }));

// Раньше просто отвечал { ok: true }, не трогая SQLite вообще — на Railway,
// где БД лежит на отдельном volume, это означало, что health-check остаётся
// зелёным, даже если volume не примонтирован или файл БД повреждён. Теперь
// делаем дешёвый `SELECT 1`: если better-sqlite3 не может выполнить запрос
// к живой БД, отдаём 503, а не молчаливый "ok".
app.get("/health", (_req, res) => {
  try {
    db.prepare("SELECT 1").get();
    res.json({ ok: true, db: true });
  } catch (err) {
    console.error("[health] БД недоступна", err);
    res.status(503).json({ ok: false, db: false });
  }
});

app.use(authRouter);
app.use(adminAccountsRouter);
app.use(aiRouter);
app.use(supportRouter);
app.use(notificationsRouter);
app.use(promosRouter);
app.use(ordersRouter);
app.use(catalogRouter);

app.use((req, res) => res.status(404).json({ error: "Not found" }));

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[unhandled]", err);
  res.status(500).json({ error: "Внутренняя ошибка сервера" });
});
