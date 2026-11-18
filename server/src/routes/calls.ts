import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { pool } from "../db";
import { ah, validate } from "../utils";

const router = Router();
router.use(requireAuth);

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(30),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

/** User call history: list of calls with duration, status and peer details */
router.get(
  "/",
  ah(async (req, res) => {
    const me = req.user!.id;
    const { limit, offset } = validate(querySchema, req.query);

    const { rows } = await pool.query(
      `SELECT c.id, c.caller_id AS "callerId", c.callee_id AS "calleeId",
              c.type, c.status, c.created_at AS "createdAt",
              c.answered_at AS "answeredAt", c.ended_at AS "endedAt",
              COALESCE(c.duration, 0) AS duration,
              u.id AS "peerId", u.username AS "peerUsername",
              u.display_name AS "peerDisplayName", u.avatar_url AS "peerAvatarUrl"
       FROM calls c
       JOIN users u ON u.id = CASE WHEN c.caller_id = $1 THEN c.callee_id ELSE c.caller_id END
       WHERE c.caller_id = $1 OR c.callee_id = $1
       ORDER BY c.created_at DESC
       LIMIT $2 OFFSET $3`,
      [me, limit + 1, offset]
    );

    const calls = rows.slice(0, limit).map((r) => ({
      id: r.id,
      callerId: r.callerId,
      calleeId: r.calleeId,
      type: r.type,
      status: r.status,
      createdAt: r.createdAt,
      answeredAt: r.answeredAt,
      endedAt: r.endedAt,
      duration: Number(r.duration),
      isCaller: r.callerId === me,
      peer: {
        id: r.peerId,
        username: r.peerUsername,
        displayName: r.peerDisplayName,
        avatarUrl: r.peerAvatarUrl,
      },
    }));

    res.json({
      calls,
      hasMore: rows.length > limit,
    });
  })
);

export default router;
