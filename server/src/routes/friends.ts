import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { pool } from "../db";
import { notify } from "../notifications";
import { emitToUser } from "../realtime";
import { ah, HttpError, isUniqueViolation, uuidSchema, validate } from "../utils";

const router = Router();
router.use(requireAuth);

/** Accepted friends, newest conversation first, with last message + unread count. */
router.get(
  "/",
  ah(async (req, res) => {
    const me = req.user!.id;
    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.display_name AS "displayName", u.avatar_url AS "avatarUrl", COALESCE(u.bio, '') AS bio, f.id AS "friendshipId",
              lm.body AS "lastBody", lm.type AS "lastType", lm.file_name AS "lastFileName", lm.created_at AS "lastAt", lm.sender_id AS "lastSender",
              COALESCE(uc.cnt, 0)::int AS unread
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
       LEFT JOIN LATERAL (
          SELECT m.body, m.type, m.file_name, m.created_at, m.sender_id
          FROM messages m
          WHERE LEAST(m.sender_id, m.receiver_id) = LEAST($1::uuid, u.id)
            AND GREATEST(m.sender_id, m.receiver_id) = GREATEST($1::uuid, u.id)
          ORDER BY m.id DESC LIMIT 1
       ) lm ON true
       LEFT JOIN LATERAL (
         SELECT count(*) AS cnt FROM messages m
         WHERE m.sender_id = u.id AND m.receiver_id = $1 AND m.read_at IS NULL
       ) uc ON true
       WHERE f.status = 'accepted' AND (f.requester_id = $1 OR f.addressee_id = $1)
       ORDER BY lm.created_at DESC NULLS LAST, u.display_name ASC`,
      [me]
    );
    res.json({
      friends: rows.map((r) => ({
        id: r.id,
        username: r.username,
        displayName: r.displayName,
        avatarUrl: r.avatarUrl,
        bio: r.bio,
        friendshipId: r.friendshipId,
        unread: r.unread,
        lastMessage: r.lastAt
          ? {
              body: r.lastBody || (r.lastType === "image" ? "📷 Image" : r.lastType === "video" ? "🎥 Video" : r.lastType === "call_log" ? "📞 Call" : "📎 File"),
              type: r.lastType,
              fileName: r.lastFileName,
              at: r.lastAt,
              senderId: r.lastSender,
            }
          : null,
      })),
    });
  })
);

/** Pending requests sent to me and sent by me. */
router.get(
  "/requests",
  ah(async (req, res) => {
    const me = req.user!.id;
    const { rows } = await pool.query(
      `SELECT f.id, f.created_at AS "createdAt", f.requester_id AS "requesterId",
              u.id AS "uid", u.username, u.display_name AS "displayName", u.avatar_url AS "avatarUrl", COALESCE(u.bio, '') AS bio
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
       WHERE f.status = 'pending' AND (f.requester_id = $1 OR f.addressee_id = $1)
       ORDER BY f.created_at DESC`,
      [me]
    );
    const shape = (r: (typeof rows)[number]) => ({
      id: r.id,
      createdAt: r.createdAt,
      user: { id: r.uid, username: r.username, displayName: r.displayName, avatarUrl: r.avatarUrl, bio: r.bio },
    });
    res.json({
      incoming: rows.filter((r) => r.requesterId !== me).map(shape),
      outgoing: rows.filter((r) => r.requesterId === me).map(shape),
    });
  })
);

/** Send a friend request. If the other user already asked me, this accepts theirs. */
router.post(
  "/requests",
  ah(async (req, res) => {
    const me = req.user!;
    const { userId } = validate(z.object({ userId: uuidSchema }), req.body);
    if (userId === me.id) throw new HttpError(400, "You cannot add yourself");

    const target = await pool.query("SELECT id FROM users WHERE id = $1", [userId]);
    if (!target.rowCount) throw new HttpError(404, "User not found");

    const existing = await pool.query(
      `SELECT id, requester_id AS "requesterId", status FROM friendships
       WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`,
      [me.id, userId]
    );
    const row = existing.rows[0];
    if (row) {
      if (row.status === "accepted") throw new HttpError(409, "You are already friends");
      if (row.requesterId === me.id) throw new HttpError(409, "Request already sent");
      // They already asked me: accept it.
      await pool.query(
        `UPDATE friendships SET status = 'accepted', updated_at = now() WHERE id = $1`,
        [row.id]
      );
      await notify(userId, "friend_accepted", me.id, { friendshipId: row.id });
      emitToUser(userId, "friend:update");
      emitToUser(me.id, "friend:update");
      res.json({ status: "accepted", id: row.id });
      return;
    }

    try {
      const { rows } = await pool.query(
        `INSERT INTO friendships (requester_id, addressee_id) VALUES ($1, $2) RETURNING id`,
        [me.id, userId]
      );
      await notify(userId, "friend_request", me.id, { friendshipId: rows[0].id });
      emitToUser(userId, "friend:update");
      emitToUser(me.id, "friend:update");
      res.status(201).json({ status: "pending", id: rows[0].id });
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, "Request already exists");
      throw err;
    }
  })
);

router.post(
  "/requests/:id/accept",
  ah(async (req, res) => {
    const me = req.user!;
    const id = validate(uuidSchema, req.params.id);
    const { rows } = await pool.query(
      `UPDATE friendships SET status = 'accepted', updated_at = now()
       WHERE id = $1 AND addressee_id = $2 AND status = 'pending'
       RETURNING requester_id AS "requesterId"`,
      [id, me.id]
    );
    if (!rows[0]) throw new HttpError(404, "Request not found");
    await notify(rows[0].requesterId, "friend_accepted", me.id, { friendshipId: id });
    emitToUser(rows[0].requesterId, "friend:update");
    emitToUser(me.id, "friend:update");
    res.json({ ok: true });
  })
);

/** Decline (addressee) or cancel (requester) a pending request. */
router.delete(
  "/requests/:id",
  ah(async (req, res) => {
    const me = req.user!;
    const id = validate(uuidSchema, req.params.id);
    const { rows } = await pool.query(
      `DELETE FROM friendships
       WHERE id = $1 AND status = 'pending' AND (requester_id = $2 OR addressee_id = $2)
       RETURNING requester_id AS "requesterId", addressee_id AS "addresseeId"`,
      [id, me.id]
    );
    if (!rows[0]) throw new HttpError(404, "Request not found");
    emitToUser(rows[0].requesterId, "friend:update");
    emitToUser(rows[0].addresseeId, "friend:update");
    res.json({ ok: true });
  })
);

export default router;
