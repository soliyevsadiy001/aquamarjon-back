import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestEnv } from "./helpers/testApp.js";

// setupTestEnv ДОЛЖЕН отработать до импорта app.js/db.js (см. комментарий
// в helpers/testApp.ts) — поэтому он вызывается на уровне модуля, а не в
// beforeAll, и импорты приложения — динамические, после него.
const { cleanup } = setupTestEnv("auth");
const { app } = await import("../src/app.js");
const { db } = await import("../src/db.js");
const bcrypt = (await import("bcryptjs")).default;
const request = (await import("supertest")).default;

function seedAccount(overrides: Partial<{ active: number; passwordHash: string; tempPassHash: string | null }> = {}) {
  const passwordHash = overrides.passwordHash ?? bcrypt.hashSync("correct-horse", 10);
  db.prepare(
    `INSERT INTO accounts (id, role, name, phone, region, login, password_plain, password_hash, temp_pass_plain, temp_pass_hash, active)
     VALUES (?, 'seller', 'Тест Продавец', '+998900000000', 'Ташкент', 'test-seller', NULL, ?, NULL, ?, ?)`
  ).run("acc_test_1", passwordHash, overrides.tempPassHash ?? null, overrides.active ?? 1);
}

describe("POST /auth/login", () => {
  beforeAll(() => {
    seedAccount();
  });

  afterAll(() => cleanup());

  it("логинит с верным паролем и отдаёт токен", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ login: "test-seller", password: "correct-horse", role: "seller" });

    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user.login).toBe("test-seller");
    // password никогда не должен утекать в ответе логина
    expect(res.body.user.password).toBeNull();
    expect(res.body.needPasswordChange).toBe(false);
  });

  it("отклоняет неверный пароль", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ login: "test-seller", password: "wrong-password", role: "seller" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBeTruthy();
  });

  it("отклоняет логин под несуществующей ролью для существующего логина", async () => {
    // Тот же логин, но роль не совпадает с записью в БД — не должен утечь
    // как "аккаунт существует, просто не та роль", а просто 401, как и
    // при неверном пароле.
    const res = await request(app)
      .post("/auth/login")
      .send({ login: "test-seller", password: "correct-horse", role: "admin" });

    expect(res.status).toBe(401);
  });

  it("требует логин, пароль и роль", async () => {
    const res = await request(app).post("/auth/login").send({ login: "test-seller" });
    expect(res.status).toBe(400);
  });

  it("пускает по временному паролю и сигналит needPasswordChange", async () => {
    const tempHash = bcrypt.hashSync("temp-pass-123", 10);
    db.prepare(`UPDATE accounts SET temp_pass_hash = ? WHERE id = ?`).run(tempHash, "acc_test_1");

    const res = await request(app)
      .post("/auth/login")
      .send({ login: "test-seller", password: "temp-pass-123", role: "seller" });

    expect(res.status).toBe(200);
    expect(res.body.needPasswordChange).toBe(true);
  });

  it("не пускает заблокированный аккаунт даже с верным паролем", async () => {
    db.prepare(`UPDATE accounts SET active = 0 WHERE id = ?`).run("acc_test_1");

    const res = await request(app)
      .post("/auth/login")
      .send({ login: "test-seller", password: "correct-horse", role: "seller" });

    expect(res.status).toBe(403);

    db.prepare(`UPDATE accounts SET active = 1 WHERE id = ?`).run("acc_test_1");
  });
});

describe("POST /auth/change-password", () => {
  beforeAll(() => {
    seedAccount();
  });

  afterAll(() => cleanup());

  it("требует авторизацию", async () => {
    const res = await request(app).post("/auth/change-password").send({ password: "new-pass-1" });
    expect(res.status).toBe(401);
  });

  it("отклоняет слишком короткий пароль", async () => {
    const login = await request(app)
      .post("/auth/login")
      .send({ login: "test-seller", password: "correct-horse", role: "seller" });
    const token = login.body.token;

    const res = await request(app)
      .post("/auth/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ password: "abc" });

    expect(res.status).toBe(400);
  });

  it("меняет пароль и обнуляет plaintext-поля", async () => {
    const login = await request(app)
      .post("/auth/login")
      .send({ login: "test-seller", password: "correct-horse", role: "seller" });
    const token = login.body.token;

    const change = await request(app)
      .post("/auth/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ password: "new-strong-pass" });
    expect(change.status).toBe(200);

    // Старый пароль больше не работает...
    const oldLogin = await request(app)
      .post("/auth/login")
      .send({ login: "test-seller", password: "correct-horse", role: "seller" });
    expect(oldLogin.status).toBe(401);

    // ...а новый работает.
    const newLogin = await request(app)
      .post("/auth/login")
      .send({ login: "test-seller", password: "new-strong-pass", role: "seller" });
    expect(newLogin.status).toBe(200);

    const row = db.prepare(`SELECT password_plain, temp_pass_hash FROM accounts WHERE id = ?`).get("acc_test_1") as any;
    expect(row.password_plain).toBeNull();
    expect(row.temp_pass_hash).toBeNull();
  });
});
