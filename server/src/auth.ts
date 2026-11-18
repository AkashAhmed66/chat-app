import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "./config";
import { pool } from "./db";
import { ah, HttpError } from "./utils";

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  bio?: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const COOKIE_NAME = "chat_token";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: "7d" });
}

export function verifyToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    if (typeof payload === "object" && typeof payload.sub === "string") return payload.sub;
    return null;
  } catch {
    return null;
  }
}

const cookieBase = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: config.cookieSecure,
  path: "/",
});

export function setAuthCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, { ...cookieBase(), maxAge: MAX_AGE_MS });
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, cookieBase());
}

export async function getUserById(id: string): Promise<AuthUser | null> {
  const { rows } = await pool.query<AuthUser>(
    `SELECT id, username, display_name AS "displayName", avatar_url AS "avatarUrl", COALESCE(bio, '') AS bio FROM users WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export const requireAuth = ah(async (req: Request, _res, next) => {
  const token = req.cookies?.[COOKIE_NAME] as string | undefined;
  const userId = token ? verifyToken(token) : null;
  const user = userId ? await getUserById(userId) : null;
  if (!user) throw new HttpError(401, "Not authenticated");
  req.user = user;
  next();
});
