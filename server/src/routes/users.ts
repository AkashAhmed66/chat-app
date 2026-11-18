import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { pool } from "../db";
import { isOnline } from "../realtime";
import { ah, validate } from "../utils";

const router = Router();

const querySchema = z.object({
  q: z.string().trim().max(60).optional().default(""),
  limit: z.coerce.number().int().min(1).max(50).optional().default(30),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

const profileUpdateSchema = z.object({
  displayName: z.string().trim().min(1, "Display name cannot be empty").max(60).optional(),
  bio: z.string().trim().max(250).optional(),
  avatarUrl: z.string().trim().nullable().optional(),
});

/** All users (except me) with their relationship to me; optional search by name/username. */
router.get(
  "/",
  requireAuth,
  ah(async (req, res) => {
    const me = req.user!.id;
    const { q, limit, offset } = validate(querySchema, req.query);
    const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;

    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.display_name AS "displayName",
              u.avatar_url AS "avatarUrl", COALESCE(u.bio, '') AS bio,
              f.id AS "friendshipId", f.status, f.requester_id AS "requesterId"
       FROM users u
       LEFT JOIN friendships f
         ON (f.requester_id = $1 AND f.addressee_id = u.id)
         OR (f.requester_id = u.id AND f.addressee_id = $1)
       WHERE u.id <> $1
         AND ($2::text = '' OR u.username ILIKE $3 OR u.display_name ILIKE $3)
       ORDER BY u.display_name ASC, u.id ASC
       LIMIT $4 OFFSET $5`,
      [me, q, pattern, limit + 1, offset]
    );

    const page = rows.slice(0, limit).map((r) => {
      let relationship: "none" | "friend" | "outgoing" | "incoming" = "none";
      if (r.status === "accepted") relationship = "friend";
      else if (r.status === "pending") relationship = r.requesterId === me ? "outgoing" : "incoming";
      return {
        id: r.id,
        username: r.username,
        displayName: r.displayName,
        avatarUrl: r.avatarUrl,
        bio: r.bio,
        relationship,
        friendshipId: r.friendshipId ?? null,
        online: isOnline(r.id),
      };
    });

    res.json({ users: page, hasMore: rows.length > limit });
  })
);

/** Get a specific user's public profile and relationship to me */
router.get(
  "/:userId",
  requireAuth,
  ah(async (req, res) => {
    const me = req.user!.id;
    const targetId = req.params.userId;

    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.display_name AS "displayName",
              u.avatar_url AS "avatarUrl", COALESCE(u.bio, '') AS bio, u.created_at AS "createdAt",
              f.id AS "friendshipId", f.status, f.requester_id AS "requesterId"
       FROM users u
       LEFT JOIN friendships f
         ON (f.requester_id = $1 AND f.addressee_id = u.id)
         OR (f.requester_id = u.id AND f.addressee_id = $1)
       WHERE u.id = $2
       LIMIT 1`,
      [me, targetId]
    );

    const r = rows[0];
    if (!r) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    let relationship: "none" | "friend" | "outgoing" | "incoming" = "none";
    if (r.status === "accepted") relationship = "friend";
    else if (r.status === "pending") relationship = r.requesterId === me ? "outgoing" : "incoming";

    res.json({
      user: {
        id: r.id,
        username: r.username,
        displayName: r.displayName,
        avatarUrl: r.avatarUrl,
        bio: r.bio,
        createdAt: r.createdAt,
        relationship,
        friendshipId: r.friendshipId ?? null,
        online: isOnline(r.id),
      },
    });
  })
);

const updateProfileHandler = ah(async (req, res) => {
  const me = req.user!.id;
  const data = validate(profileUpdateSchema, req.body);

  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (data.displayName !== undefined) {
    fields.push(`display_name = $${idx++}`);
    values.push(data.displayName);
  }
  if (data.bio !== undefined) {
    fields.push(`bio = $${idx++}`);
    values.push(data.bio);
  }
  if (data.avatarUrl !== undefined) {
    fields.push(`avatar_url = $${idx++}`);
    values.push(data.avatarUrl);
  }

  if (fields.length === 0) {
    res.json({ user: req.user });
    return;
  }

  values.push(me);
  const { rows } = await pool.query(
    `UPDATE users
     SET ${fields.join(", ")}
     WHERE id = $${idx}
     RETURNING id, username, display_name AS "displayName", avatar_url AS "avatarUrl", COALESCE(bio, '') AS bio`,
    values
  );

  res.json({ user: rows[0] });
});

/** Update current user's profile */
router.put("/profile", requireAuth, updateProfileHandler);
router.post("/profile", requireAuth, updateProfileHandler);

export default router;
