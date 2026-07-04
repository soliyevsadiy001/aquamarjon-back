import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../env.js";
import type { AuthedRequestUser, Role } from "../types.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedRequestUser;
    }
  }
}

export function signToken(user: AuthedRequestUser): string {
  return jwt.sign(user, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
}

/** Требует валидный Bearer-токен (любая роль). 401, если токена нет/невалиден. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "NO_TOKEN" });
  try {
    req.user = jwt.verify(token, env.JWT_SECRET) as AuthedRequestUser;
    next();
  } catch {
    return res.status(401).json({ error: "INVALID_TOKEN" });
  }
}

/** Требует роль admin — вешать ПОСЛЕ requireAuth. */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "FORBIDDEN" });
    }
    next();
  };
}
