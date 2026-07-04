import bcrypt from "bcryptjs";
import { db } from "./db.js";
import { env } from "./env.js";

// Запускается один раз командой `npm run seed:admin`, после того как
// в .env заданы ADMIN_SEED_LOGIN/ADMIN_SEED_PASSWORD. Идемпотентен —
// если admin с таким login уже есть, просто ничего не делает (не сбрасывает
// пароль, чтобы случайный повторный запуск не откатил ручную смену пароля).

if (!env.ADMIN_SEED_LOGIN || !env.ADMIN_SEED_PASSWORD) {
  console.error(
    "[seed-admin] Задайте ADMIN_SEED_LOGIN и ADMIN_SEED_PASSWORD в .env перед запуском."
  );
  process.exit(1);
}

const existing = db
  .prepare(`SELECT id FROM accounts WHERE login = ? AND role = 'admin'`)
  .get(env.ADMIN_SEED_LOGIN);

if (existing) {
  console.log(`[seed-admin] Admin "${env.ADMIN_SEED_LOGIN}" уже существует — пропускаю.`);
  process.exit(0);
}

const id = `a_${Date.now()}`;
const passwordHash = bcrypt.hashSync(env.ADMIN_SEED_PASSWORD, 10);

db.prepare(
  `INSERT INTO accounts (id, role, name, phone, region, login, password_plain, password_hash, active, last_login)
   VALUES (?, 'admin', ?, ?, '—', ?, NULL, ?, 1, '—')`
).run(id, env.ADMIN_SEED_NAME, env.ADMIN_SEED_PHONE, env.ADMIN_SEED_LOGIN, passwordHash);

console.log(`[seed-admin] Создан admin "${env.ADMIN_SEED_LOGIN}". Не забудьте сменить пароль после первого входа.`);
