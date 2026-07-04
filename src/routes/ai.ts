import { Router } from "express";
import rateLimit from "express-rate-limit";
import { env } from "../env.js";

export const aiRouter = Router();

// AI-запросы стоят реальных денег (Anthropic API) — лимитим агрессивнее
// обычных ручек, чтобы один пользователь/бот не выжег весь бюджет.
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

async function callAnthropic(system: string, messages: unknown[]): Promise<string> {
  if (!env.ANTHROPIC_API_KEY) {
    throw Object.assign(new Error("ANTHROPIC_API_KEY не задан на бэкенде"), { status: 503 });
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 1024,
      system,
      messages,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(new Error(`Anthropic API error ${res.status}: ${text}`), { status: 502 });
  }
  const data = (await res.json()) as any;
  const text = Array.isArray(data.content) ? data.content.map((b: any) => b.text || "").join("") : "";
  return text;
}

function makeHandler() {
  return async (req: import("express").Request, res: import("express").Response) => {
    const { system, messages } = req.body || {};
    if (!system || !Array.isArray(messages)) {
      return res.status(400).json({ error: "system и messages обязательны" });
    }
    try {
      const text = await callAnthropic(system, messages);
      res.json({ text });
    } catch (err: any) {
      const status = err?.status || 500;
      // Не палим детали Anthropic-ответа наружу — только в серверный лог.
      console.error("[ai proxy]", err);
      res.status(status).json({ error: status === 503 ? "AI временно недоступен" : "Ошибка AI-сервиса" });
    }
  };
}

aiRouter.post("/ai/chat", aiLimiter, makeHandler());
aiRouter.post("/ai/diagnose", aiLimiter, makeHandler());
