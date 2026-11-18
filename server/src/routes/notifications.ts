import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { pool } from "../db";
import { mapNotification, NOTIFICATION_SELECT } from "../notifications";
import { ah, uuidSchema, validate } from "../utils";

const router = Router();
router.use(requireAuth);

router.get(
  "/",
  ah(async (req, res) => {
    const me = req.user!.id;
    const { rows } = await pool.query(
      `SELECT ${NOTIFICATION_SELECT}
       FROM notifications n LEFT JOIN users a ON a.id = n.actor_id
       WHERE n.user_id = $1
       ORDER BY n.created_at DESC LIMIT 50`,
      [me]
    );
    res.json({ notifications: rows.map(mapNotification) });
  })
);

/** Mark the given notifications (or all, if no ids are sent) as read. */
router.post(
  "/read",
  ah(async (req, res) => {
    const me = req.user!.id;
    const { ids } = validate(z.object({ ids: z.array(uuidSchema).max(200).optional() }), req.body ?? {});
    await pool.query(
      `UPDATE notifications SET read_at = now()
       WHERE user_id = $1 AND read_at IS NULL AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))`,
      [me, ids ?? null]
    );
    res.json({ ok: true });
  })
);

export default router;
