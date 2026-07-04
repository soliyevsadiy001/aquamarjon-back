import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { db } from "../db.js";
import { requireAuth, signToken } from "../middleware/auth.js";
import { toAccountDTO, rowToAccount } from "./accounts-shared.js";

export const authRouter = Router();

// Логин перебором пароля — классическая цель брутфорса, поэтому лимитим
// отдельно и жёстче, чем остальной API.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

authRouter.post("/auth/login", loginLimiter, (req, res) => {
  const { login, password, role } = req.body || {};
  if (!login || !password || !role) {
    return res.status(400).json({ error: "Логин, пароль и роль обязательны" });
  }

  const row = db
    .prepare(`SELECT * FROM accounts WHERE login = ? AND role = ?`)
    .get(String(login).trim().toLowerCase(), role) as any;

  if (!row) return res.status(401).json({ error: "Неверный логин или пароль" });
  if (!row.active) return res.status(403).json({ error: "Аккаунт заблокирован." });

  const matchesPermanent = bcrypt.compareSync(password, row.password_hash);
  const matchesTemp = row.temp_pass_hash ? bcrypt.compareSync(password, row.temp_pass_hash) : false;

  if (!matchesPermanent && !matchesTemp) {
    return res.status(401).json({ error: "Неверный логин или пароль" });
  }

  db.prepare(`UPDATE accounts SET last_login = ? WHERE id = ?`).run(
    new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }),
    row.id
  );

  const token = signToken({ id: row.id, role: row.role });
  const account = rowToAccount(db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(row.id) as any);

  // needPasswordChange истинно, если зашли по временному паролю (после
  // сброса админом) — фронт после этого показывает ChangePasswordScreen.
  res.json({ token, user: toAccountDTO(account), needPasswordChange: matchesTemp });
});

// Не было раньше вызвано с фронта вообще — ChangePasswordScreen только менял
// пароль в локальном состоянии (auth.changePassword), ничего не отправляя на
// бэкенд, то есть после реального логина пароль "терялся" при следующем входе.
// Этот эндпоинт + маленький патч в useAuth.ts (см. сопроводительное письмо)
// закрывают дыру: смена пароля теперь реально сохраняется.
authRouter.post("/auth/change-password", requireAuth, (req, res) => {
  const { password } = req.body || {};
  if (!password || String(password).length < 4) {
    return res.status(400).json({ error: "Пароль должен быть не короче 4 символов" });
  }
  const hash = bcrypt.hashSync(password, 10);
  // password_plain = NULL, а не сам пароль: раньше самостоятельная смена
  // пароля тихо возвращала ровно ту дыру, которую мы закрываем в
  // adminAccounts.ts — постоянно читаемый plaintext в БД. Хеша достаточно
  // для входа (см. /auth/login выше), plaintext здесь никому не нужен.
  db.prepare(
    `UPDATE accounts SET password_plain = NULL, password_hash = ?, temp_pass_plain = NULL, temp_pass_hash = NULL WHERE id = ?`
  ).run(hash, req.user!.id);
  res.json({ ok: true });
});
