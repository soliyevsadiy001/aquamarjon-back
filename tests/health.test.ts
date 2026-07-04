import { afterAll, describe, expect, it } from "vitest";
import { setupTestEnv } from "./helpers/testApp.js";

const { cleanup } = setupTestEnv("health");
const { app } = await import("../src/app.js");
const request = (await import("supertest")).default;

afterAll(() => cleanup());

describe("GET /health", () => {
  it("отвечает ok:true и db:true, когда SQLite доступна", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, db: true });
  });
});
