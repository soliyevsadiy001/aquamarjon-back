import { afterAll, describe, expect, it } from "vitest";
import { setupTestEnv } from "./helpers/testApp.js";

const { cleanup } = setupTestEnv("orders");
const { app } = await import("../src/app.js");
const { db } = await import("../src/db.js");
const request = (await import("supertest")).default;

afterAll(() => cleanup());

function catalogItem() {
  // guppy — первая позиция в CATALOG_SEED, цена 25000 (см. catalog-seed.ts).
  const row = db.prepare(`SELECT id, price FROM catalog WHERE id = 'guppy'`).get() as { id: string; price: number };
  return row;
}

describe("POST /orders — защита цены по каталогу", () => {
  it("отклоняет пустую корзину", async () => {
    const res = await request(app).post("/orders").send({ items: [] });
    expect(res.status).toBe(400);
  });

  it("создаёт заказ с ценой, совпадающей с каталогом", async () => {
    const item = catalogItem();
    const res = await request(app)
      .post("/orders")
      .send({
        phone: "+998900000000",
        region: "Ташкент",
        items: [{ id: item.id, name: "Гуппи", price: item.price, qty: 1 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.order_id).toEqual(expect.any(String));
  });

  it("пропускает цену чуть выше каталожной (в пределах допуска на варианты)", async () => {
    const item = catalogItem();
    const res = await request(app)
      .post("/orders")
      .send({ items: [{ id: item.id, name: "Гуппи XL", price: item.price * 1.1, qty: 1 }] });
    expect(res.status).toBe(201);
  });

  it("отклоняет заказ с заниженной ценой позиции (попытка обхода через devtools)", async () => {
    const item = catalogItem();
    const res = await request(app)
      .post("/orders")
      .send({ items: [{ id: item.id, name: "Гуппи", price: 1, qty: 1 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/каталог/i);
  });

  it("отклоняет позицию без id или названия", async () => {
    const res = await request(app)
      .post("/orders")
      .send({ items: [{ price: 1000, qty: 1 }] });
    expect(res.status).toBe(400);
  });

  it("отклоняет неадекватно высокую цену позиции", async () => {
    const res = await request(app)
      .post("/orders")
      .send({ items: [{ id: "unknown-bundle", name: "Бандл", price: 99_000_000, qty: 1 }] });
    expect(res.status).toBe(400);
  });
});

describe("GET/PATCH /orders — доступ по ролям", () => {
  function seedAccountAndToken(role: "admin" | "seller" | "courier", name: string) {
    const id = `acc_${role}_${Math.random().toString(36).slice(2)}`;
    db.prepare(
      `INSERT INTO accounts (id, role, name, phone, region, login, password_plain, password_hash, active)
       VALUES (?, ?, ?, '+998900000000', 'Ташкент', ?, NULL, 'x', 1)`
    ).run(id, role, name, `login-${id}`);
    return id;
  }

  async function tokenFor(id: string, role: "admin" | "seller" | "courier") {
    // Через реальный /auth/login токен не получить без известного пароля —
    // подписываем напрямую тем же секретом, что и signToken в middleware/auth.ts,
    // это ровно то же самое, что делает сервер после успешного логина.
    const jwt = (await import("jsonwebtoken")).default;
    return jwt.sign({ id, role }, process.env.JWT_SECRET as string, { expiresIn: "1h" });
  }

  it("без токена /orders недоступен", async () => {
    const res = await request(app).get("/orders");
    expect(res.status).toBe(401);
  });

  it("курьер видит только заказы, назначенные на его имя", async () => {
    const item = catalogItem();
    const courierId = seedAccountAndToken("courier", "Курьер Иван");
    const otherCourierId = seedAccountAndToken("courier", "Курьер Пётр");

    const created = await request(app)
      .post("/orders")
      .send({ items: [{ id: item.id, name: "Гуппи", price: item.price, qty: 1 }] });
    const orderId = created.body.order_id;

    const adminId = seedAccountAndToken("admin", "Админ");
    const adminToken = await tokenFor(adminId, "admin");
    await request(app)
      .post(`/orders/${orderId}/assign-courier`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ courierName: "Курьер Иван" });

    const ivanToken = await tokenFor(courierId, "courier");
    const petrToken = await tokenFor(otherCourierId, "courier");

    const ivanOrders = await request(app).get("/orders").set("Authorization", `Bearer ${ivanToken}`);
    expect(ivanOrders.status).toBe(200);
    expect(ivanOrders.body.some((o: any) => o.id === orderId)).toBe(true);

    const petrOrders = await request(app).get("/orders").set("Authorization", `Bearer ${petrToken}`);
    expect(petrOrders.body.some((o: any) => o.id === orderId)).toBe(false);
  });

  it("курьер не может назначать курьеров (только admin)", async () => {
    const courierId = seedAccountAndToken("courier", "Курьер Не-админ");
    const courierToken = await tokenFor(courierId, "courier");

    const item = catalogItem();
    const created = await request(app)
      .post("/orders")
      .send({ items: [{ id: item.id, name: "Гуппи", price: item.price, qty: 1 }] });

    const res = await request(app)
      .post(`/orders/${created.body.order_id}/assign-courier`)
      .set("Authorization", `Bearer ${courierToken}`)
      .send({ courierName: "Курьер Не-админ" });

    expect(res.status).toBe(403);
  });

  it("курьер не может менять статус чужого заказа", async () => {
    const item = catalogItem();
    const created = await request(app)
      .post("/orders")
      .send({ items: [{ id: item.id, name: "Гуппи", price: item.price, qty: 1 }] });

    const courierId = seedAccountAndToken("courier", "Не назначен");
    const courierToken = await tokenFor(courierId, "courier");

    const res = await request(app)
      .patch(`/orders/${created.body.order_id}/status`)
      .set("Authorization", `Bearer ${courierToken}`)
      .send({ status: "way" });

    expect(res.status).toBe(403);
  });

  it("отклоняет недопустимый статус", async () => {
    const item = catalogItem();
    const created = await request(app)
      .post("/orders")
      .send({ items: [{ id: item.id, name: "Гуппи", price: item.price, qty: 1 }] });

    const adminId = seedAccountAndToken("admin", "Админ2");
    const adminToken = await tokenFor(adminId, "admin");

    const res = await request(app)
      .patch(`/orders/${created.body.order_id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "not-a-real-status" });

    expect(res.status).toBe(400);
  });
});
