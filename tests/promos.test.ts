import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestEnv } from "./helpers/testApp.js";

const { cleanup } = setupTestEnv("promos");
const { app } = await import("../src/app.js");
const { db } = await import("../src/db.js");
const request = (await import("supertest")).default;

afterAll(() => cleanup());

function catalogItem() {
  const row = db.prepare(`SELECT id, price FROM catalog WHERE id = 'guppy'`).get() as { id: string; price: number };
  return row;
}

describe("POST /promos/validate", () => {
  beforeAll(() => {
    db.prepare(
      `INSERT INTO promos (code, type, value, min_order_sum, max_uses, uses, active, expires_at)
       VALUES ('SAVE10', 'percent', 10, 50000, NULL, 0, 1, NULL)`
    ).run();
    db.prepare(
      `INSERT INTO promos (code, type, value, min_order_sum, max_uses, uses, active, expires_at)
       VALUES ('MAXEDOUT', 'fixed', 5000, NULL, 1, 1, 1, NULL)`
    ).run();
    db.prepare(
      `INSERT INTO promos (code, type, value, min_order_sum, max_uses, uses, active, expires_at)
       VALUES ('EXPIRED', 'fixed', 5000, NULL, NULL, 0, 1, '2000-01-01')`
    ).run();
  });

  afterAll(() => cleanup());

  it("404 для несуществующего кода", async () => {
    const res = await request(app).post("/promos/validate").send({ code: "NOPE", cart_total: 100000 });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("PROMO_NOT_FOUND");
  });

  it("400 без кода", async () => {
    const res = await request(app).post("/promos/validate").send({ cart_total: 100000 });
    expect(res.status).toBe(400);
  });

  it("применяет промокод при достаточной сумме (регистр и пробелы не важны)", async () => {
    const res = await request(app).post("/promos/validate").send({ code: " save10 ", cart_total: 60000 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ type: "percent", value: 10 });
  });

  it("отклоняет по min_order_sum, если cart_total ниже порога", async () => {
    const res = await request(app).post("/promos/validate").send({ code: "SAVE10", cart_total: 10000 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("PROMO_MIN_ORDER");
  });

  it("не даёт обойти min_order_sum завышенным cart_total, если пересчёт по каталогу говорит об обратном", async () => {
    const item = catalogItem();
    // Клиент присылает завышенный cart_total (проходит порог 50000 на
    // словах), но реальная корзина по каталожной цене — сильно дешевле.
    // См. комментарий в routes/promos.ts: именно эту дыру закрывает
    // пересчёт по `items`.
    const res = await request(app)
      .post("/promos/validate")
      .send({
        code: "SAVE10",
        cart_total: 999999,
        items: [{ id: item.id, qty: 1 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("PROMO_MIN_ORDER");
  });

  it("410 для промокода с исчерпанным лимитом использований", async () => {
    const res = await request(app).post("/promos/validate").send({ code: "MAXEDOUT", cart_total: 100000 });
    expect(res.status).toBe(410);
    expect(res.body.error).toBe("PROMO_LIMIT_REACHED");
  });

  it("410 для просроченного промокода", async () => {
    const res = await request(app).post("/promos/validate").send({ code: "EXPIRED", cart_total: 100000 });
    expect(res.status).toBe(410);
    expect(res.body.error).toBe("PROMO_EXPIRED");
  });

  it("не расходует лимит использований при простой проверке (uses не растёт)", async () => {
    const before = db.prepare(`SELECT uses FROM promos WHERE code = 'SAVE10'`).get() as { uses: number };
    await request(app).post("/promos/validate").send({ code: "SAVE10", cart_total: 60000 });
    await request(app).post("/promos/validate").send({ code: "SAVE10", cart_total: 60000 });
    const after = db.prepare(`SELECT uses FROM promos WHERE code = 'SAVE10'`).get() as { uses: number };
    expect(after.uses).toBe(before.uses);
  });
});
