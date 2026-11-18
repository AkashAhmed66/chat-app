import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { pool } from "../db";
import { areFriends } from "../friends-util";
import { emitToUser } from "../realtime";
import { ah, HttpError, uuidSchema, validate } from "../utils";

const router = Router();
router.use(requireAuth);

const passwordSchema = z.object({
  password: z.string().min(3, "Password must be at least 3 characters").max(50),
});

/** Get the current chat lock status for conversation with friend */
router.get(
  "/:friendId",
  ah(async (req, res) => {
    const me = req.user!.id;
    const friendId = validate(uuidSchema, req.params.friendId);
    if (!(await areFriends(me, friendId))) {
      throw new HttpError(403, "You can only lock chats with friends");
    }

    const { rows } = await pool.query<{
      status: "none" | "requested" | "active";
      requesterId: string | null;
      requesterName: string | null;
    }>(
      `SELECT cl.status, cl.requester_id AS "requesterId", u.display_name AS "requesterName"
       FROM chat_locks cl
       LEFT JOIN users u ON u.id = cl.requester_id
       WHERE LEAST(cl.user1_id, cl.user2_id) = LEAST($1::uuid, $2::uuid)
         AND GREATEST(cl.user1_id, cl.user2_id) = GREATEST($1::uuid, $2::uuid)
       LIMIT 1`,
      [me, friendId]
    );

    const lock = rows[0];
    if (!lock) {
      res.json({
        status: "none",
        isRequester: false,
        requesterName: null,
      });
      return;
    }

    res.json({
      status: lock.status,
      isRequester: lock.requesterId === me,
      requesterName: lock.requesterName,
    });
  })
);

/** Request chat password protection (User A sets proposed password) */
router.post(
  "/:friendId/request",
  ah(async (req, res) => {
    const me = req.user!.id;
    const friendId = validate(uuidSchema, req.params.friendId);
    const { password } = validate(passwordSchema, req.body);

    if (!(await areFriends(me, friendId))) {
      throw new HttpError(403, "You can only lock chats with friends");
    }

    const hash = await bcrypt.hash(password, 10);

    await pool.query(
      `INSERT INTO chat_locks (user1_id, user2_id, status, requester_id, pending_hash, password_hash, updated_at)
       VALUES (LEAST($1::uuid, $2::uuid), GREATEST($1::uuid, $2::uuid), 'requested', $1, $3, NULL, now())
       ON CONFLICT (LEAST(user1_id, user2_id), GREATEST(user1_id, user2_id))
       DO UPDATE SET status = 'requested', requester_id = $1, pending_hash = $3, password_hash = NULL, updated_at = now()`,
      [me, friendId, hash]
    );

    // Notify the other user in real-time
    emitToUser(friendId, "chat_lock:update", {
      friendId: me,
      status: "requested",
      isRequester: false,
      requesterName: req.user!.displayName,
    });

    res.json({
      ok: true,
      status: "requested",
      isRequester: true,
      requesterName: req.user!.displayName,
    });
  })
);

/** Accept chat password protection (User B enters matching password) */
router.post(
  "/:friendId/accept",
  ah(async (req, res) => {
    const me = req.user!.id;
    const friendId = validate(uuidSchema, req.params.friendId);
    const { password } = validate(passwordSchema, req.body);

    if (!(await areFriends(me, friendId))) {
      throw new HttpError(403, "You can only lock chats with friends");
    }

    const { rows } = await pool.query<{
      status: string;
      requester_id: string;
      pending_hash: string | null;
    }>(
      `SELECT status, requester_id, pending_hash
       FROM chat_locks
       WHERE LEAST(user1_id, user2_id) = LEAST($1::uuid, $2::uuid)
         AND GREATEST(user1_id, user2_id) = GREATEST($1::uuid, $2::uuid)
       LIMIT 1`,
      [me, friendId]
    );

    const lock = rows[0];
    if (!lock || lock.status !== "requested" || !lock.pending_hash) {
      throw new HttpError(400, "No pending password protection request for this chat");
    }

    if (lock.requester_id === me) {
      throw new HttpError(400, "You cannot accept your own protection request");
    }

    // Verify if both entered the same password!
    const matches = await bcrypt.compare(password, lock.pending_hash);
    if (!matches) {
      throw new HttpError(
        400,
        "Password does not match. Both users must enter the identical agreed password."
      );
    }

    // Both entered the same password: activate protection!
    await pool.query(
      `UPDATE chat_locks
       SET status = 'active', password_hash = pending_hash, pending_hash = NULL, updated_at = now()
       WHERE LEAST(user1_id, user2_id) = LEAST($1::uuid, $2::uuid)
         AND GREATEST(user1_id, user2_id) = GREATEST($1::uuid, $2::uuid)`,
      [me, friendId]
    );

    // Notify both users in real-time
    emitToUser(me, "chat_lock:update", {
      friendId,
      status: "active",
    });
    emitToUser(friendId, "chat_lock:update", {
      friendId: me,
      status: "active",
    });

    res.json({ ok: true, status: "active" });
  })
);

/** Cancel or decline a pending chat protection request */
router.post(
  "/:friendId/cancel",
  ah(async (req, res) => {
    const me = req.user!.id;
    const friendId = validate(uuidSchema, req.params.friendId);

    await pool.query(
      `UPDATE chat_locks
       SET status = 'none', pending_hash = NULL, updated_at = now()
       WHERE LEAST(user1_id, user2_id) = LEAST($1::uuid, $2::uuid)
         AND GREATEST(user1_id, user2_id) = GREATEST($1::uuid, $2::uuid)
         AND status = 'requested'`,
      [me, friendId]
    );

    emitToUser(me, "chat_lock:update", { friendId, status: "none" });
    emitToUser(friendId, "chat_lock:update", { friendId: me, status: "none" });

    res.json({ ok: true, status: "none" });
  })
);

/** Verify chat password to unlock conversation view */
router.post(
  "/:friendId/verify",
  ah(async (req, res) => {
    const me = req.user!.id;
    const friendId = validate(uuidSchema, req.params.friendId);
    const { password } = validate(passwordSchema, req.body);

    const { rows } = await pool.query<{
      status: string;
      password_hash: string | null;
    }>(
      `SELECT status, password_hash
       FROM chat_locks
       WHERE LEAST(user1_id, user2_id) = LEAST($1::uuid, $2::uuid)
         AND GREATEST(user1_id, user2_id) = GREATEST($1::uuid, $2::uuid)
       LIMIT 1`,
      [me, friendId]
    );

    const lock = rows[0];
    if (!lock || lock.status !== "active" || !lock.password_hash) {
      // If not locked, it's considered verified
      res.json({ ok: true, verified: true });
      return;
    }

    const matches = await bcrypt.compare(password, lock.password_hash);
    if (!matches) {
      throw new HttpError(401, "Incorrect password for this chat");
    }

    res.json({ ok: true, verified: true });
  })
);

/** Remove password protection (requires entering current password) */
router.post(
  "/:friendId/remove",
  ah(async (req, res) => {
    const me = req.user!.id;
    const friendId = validate(uuidSchema, req.params.friendId);
    const { password } = validate(passwordSchema, req.body);

    const { rows } = await pool.query<{
      status: string;
      password_hash: string | null;
    }>(
      `SELECT status, password_hash
       FROM chat_locks
       WHERE LEAST(user1_id, user2_id) = LEAST($1::uuid, $2::uuid)
         AND GREATEST(user1_id, user2_id) = GREATEST($1::uuid, $2::uuid)
       LIMIT 1`,
      [me, friendId]
    );

    const lock = rows[0];
    if (!lock || lock.status !== "active" || !lock.password_hash) {
      res.json({ ok: true, status: "none" });
      return;
    }

    const matches = await bcrypt.compare(password, lock.password_hash);
    if (!matches) {
      throw new HttpError(401, "Incorrect current password");
    }

    await pool.query(
      `UPDATE chat_locks
       SET status = 'none', password_hash = NULL, pending_hash = NULL, updated_at = now()
       WHERE LEAST(user1_id, user2_id) = LEAST($1::uuid, $2::uuid)
         AND GREATEST(user1_id, user2_id) = GREATEST($1::uuid, $2::uuid)`,
      [me, friendId]
    );

    emitToUser(me, "chat_lock:update", { friendId, status: "none" });
    emitToUser(friendId, "chat_lock:update", { friendId: me, status: "none" });

    res.json({ ok: true, status: "none" });
  })
);

export default router;
