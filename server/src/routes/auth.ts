import bcrypt from "bcryptjs";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { clearAuthCookie, requireAuth, setAuthCookie, signToken } from "../auth";
import { pool } from "../db";
import { ah, HttpError, isUniqueViolation, validate } from "../utils";

const router = Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many attempts, please try again later" },
});

const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "Username must be at least 3 characters")
    .max(30, "Username must be at most 30 characters")
    .regex(/^[a-zA-Z0-9_]+$/, "Username may only contain letters, numbers and underscores"),
  displayName: z.string().trim().min(1, "Display name is required").max(60),
  email: z.string().trim().email("Enter a valid email").max(255),
  password: z.string().min(8, "Password must be at least 8 characters").max(72),
});

const loginSchema = z.object({
  identifier: z.string().trim().min(1, "Enter your username or email").max(255),
  password: z.string().min(1, "Enter your password").max(72),
});

// A real hash so unknown-user logins cost the same as wrong-password logins.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);

router.post(
  "/register",
  limiter,
  ah(async (req, res) => {
    const body = validate(registerSchema, req.body);
    const hash = await bcrypt.hash(body.password, 12);
    try {
      const { rows } = await pool.query(
        `INSERT INTO users (username, display_name, email, password_hash)
         VALUES ($1, $2, $3, $4)
         RETURNING id, username, display_name AS "displayName", avatar_url AS "avatarUrl", COALESCE(bio, '') AS bio`,
        [body.username, body.displayName, body.email, hash]
      );
      setAuthCookie(res, signToken(rows[0].id));
      res.status(201).json({ user: rows[0] });
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, "Username or email is already taken");
      throw err;
    }
  })
);

router.post(
  "/login",
  limiter,
  ah(async (req, res) => {
    const body = validate(loginSchema, req.body);
    const { rows } = await pool.query(
      `SELECT id, username, display_name AS "displayName", avatar_url AS "avatarUrl", COALESCE(bio, '') AS bio, password_hash
       FROM users WHERE lower(username) = lower($1) OR lower(email) = lower($1)
       LIMIT 1`,
      [body.identifier]
    );
    const row = rows[0];
    const ok = await bcrypt.compare(body.password, row?.password_hash ?? DUMMY_HASH);
    if (!row || !ok) throw new HttpError(401, "Invalid username/email or password");
    setAuthCookie(res, signToken(row.id));
    res.json({
      user: {
        id: row.id,
        username: row.username,
        displayName: row.displayName,
        avatarUrl: row.avatarUrl,
        bio: row.bio,
      },
    });
  })
);

router.post("/logout", (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
