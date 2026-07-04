import { Router } from "express";
import { db } from "../db.js";

export const catalogRouter = Router();

// Публичная ручка — фронту она пока не нужна (каталог с описаниями/картинками
// по-прежнему живёт в data/fish.ts), но она уже используется как источник
// истины по ценам внутри orders.ts/promos.ts. Отдаём наружу тоже, чтобы
// фронт мог свериться с ней при желании (и для ручной проверки).
catalogRouter.get("/catalog", (_req, res) => {
  const rows = db.prepare(`SELECT id, name, price, active FROM catalog WHERE active = 1 ORDER BY id`).all();
  res.json(rows);
});
