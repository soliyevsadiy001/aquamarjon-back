import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { toAccountDTO, toAccountDTOWithSecret } from "./accounts-shared.js";

export const adminAccountsRouter = Router();

// Всё в этом файле — только для роли admin.
adminAccountsRouter.use("/admin/accounts", requireAuth, requireRole("admin"));

// ⚠️ "password" сюда намеренно НЕ входит: раньше админ мог напрямую
// перезаписать пароль через PATCH { field: "password", value } в любой
// момент, а бэкенд услужливо хранил и отдавал его открытым текстом при
// каждом GET. Теперь единственный способ сменить пароль извне —
// POST /admin/accounts/:id/reset-password (см. ниже), который выдаёт
// временный пароль ОДИН РАЗ в ответе и не хранит его постоянно читаемым.
const ALLOWED_FIELDS = new Set(["name", "phone", "region", "login", "active"]);

function genTempPass(): string {
  // 6 символов, без похожих друг на друга (0/O, 1/I) — чтобы диктовать по телефону было легко.
  const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  let out = "";
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

adminAccountsRouter.get("/admin/accounts", (_req, res) => {
  const rows = db.prepare(`SELECT * FROM accounts ORDER BY created_at DESC`).all() as any[];
  res.json(rows.map(toAccountDTO));
});

adminAccountsRouter.post("/admin/accounts", (req, res) => {
  const { role, name, phone, region, login, password } = req.body || {};
  if (!role || !name || !login || !password) {
    return res.status(400).json({ error: "role, name, login и password обязательны" });
  }
  const normalizedLogin = String(login).trim().toLowerCase();

  const dup = db.prepare(`SELECT id FROM accounts WHERE login = ? AND role = ?`).get(normalizedLogin, role);
  if (dup) return res.status(409).json({ error: "Логин уже занят другим аккаунтом" });

  const id = `${String(role)[0]}_${Date.now()}`;
  const passwordHash = bcrypt.hashSync(password, 10);
  db.prepare(
    `INSERT INTO accounts (id, role, name, phone, region, login, password_plain, password_hash, active, last_login)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, '—')`
  ).run(id, role, name, phone || "", region || "—", normalizedLogin, password, passwordHash);

  const row = db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(id) as any;
  // Отдаём пароль в ответе ОДИН РАЗ (админ должен успеть продиктовать его
  // продавцу/курьеру сейчас) и сразу же зануляем plaintext-копию в БД —
  // после этого её физически неоткуда прочитать повторно. Логин по-прежнему
  // работает через password_hash, который остаётся нетронутым.
  db.prepare(`UPDATE accounts SET password_plain = NULL WHERE id = ?`).run(id);
  res.status(201).json(toAccountDTOWithSecret(row, password));
});

adminAccountsRouter.patch("/admin/accounts/:id", (req, res) => {
  const { field, value } = req.body || {};
  if (field === "password") {
    return res.status(400).json({
      error: "Смена пароля через это поле отключена. Используйте POST /admin/accounts/:id/reset-password.",
    });
  }
  if (!ALLOWED_FIELDS.has(field)) {
    return res.status(400).json({ error: `Недопустимое поле: ${field}` });
  }
  const row = db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: "Аккаунт не найден" });

  if (field === "login") {
    const normalized = String(value).trim().toLowerCase();
    const dup = db
      .prepare(`SELECT id FROM accounts WHERE login = ? AND role = ? AND id != ?`)
      .get(normalized, row.role, row.id);
    if (dup) return res.status(409).json({ error: "Логин уже занят другим аккаунтом" });
    db.prepare(`UPDATE accounts SET login = ? WHERE id = ?`).run(normalized, row.id);
  } else if (field === "active") {
    db.prepare(`UPDATE accounts SET active = ? WHERE id = ?`).run(value ? 1 : 0, row.id);
  } else if (field === "name") {
    db.prepare(`UPDATE accounts SET name = ? WHERE id = ?`).run(String(value ?? ""), row.id);
  } else if (field === "phone") {
    db.prepare(`UPDATE accounts SET phone = ? WHERE id = ?`).run(String(value ?? ""), row.id);
  } else {
    // Не должно случиться: field уже проверен через ALLOWED_FIELDS выше,
    // а все его значения разобраны явными ветками. Раньше здесь был
    // фолбэк `UPDATE accounts SET ${field} = ?` — он был безопасен только
    // пока ALLOWED_FIELDS случайно не разъедется со списком веток; теперь
    // разъехаться некуда, и это правило гарантированно ловит такую ошибку
    // на этапе ревью/тестов, а не оставляет тихую дыру под интерполяцию
    // имени колонки.
    return res.status(400).json({ error: `Недопустимое поле: ${field}` });
  }

  const updated = db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(row.id) as any;
  res.json(toAccountDTO(updated));
});

adminAccountsRouter.post("/admin/accounts/:id/toggle", (req, res) => {
  const row = db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: "Аккаунт не найден" });
  db.prepare(`UPDATE accounts SET active = ? WHERE id = ?`).run(row.active ? 0 : 1, row.id);
  const updated = db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(row.id) as any;
  res.json(toAccountDTO(updated));
});

adminAccountsRouter.delete("/admin/accounts/:id", (req, res) => {
  const info = db.prepare(`DELETE FROM accounts WHERE id = ?`).run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Аккаунт не найден" });
  res.status(204).end();
});

adminAccountsRouter.post("/admin/accounts/:id/reset-password", (req, res) => {
  const row = db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: "Аккаунт не найден" });
  const tempPass = genTempPass();
  const tempHash = bcrypt.hashSync(tempPass, 10);
  // password_plain = NULL заодно — на случай если он остался от аккаунтов,
  // созданных до этого изменения (миграции нет, старые plaintext-строки
  // могли всё ещё лежать в БД). Сброс пароля — естественный момент их стереть.
  db.prepare(
    `UPDATE accounts SET temp_pass_plain = ?, temp_pass_hash = ?, password_plain = NULL WHERE id = ?`
  ).run(tempPass, tempHash, row.id);
  res.json({ tempPass });
});
