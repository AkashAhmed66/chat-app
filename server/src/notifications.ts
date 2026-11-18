import { pool } from "./db";
import { emitToUser } from "./realtime";

export type NotificationType = "friend_request" | "friend_accepted" | "missed_call";

interface NotificationRow {
  id: string;
  type: string;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
  actorId: string | null;
  actorUsername: string | null;
  actorDisplayName: string | null;
}

export const NOTIFICATION_SELECT = `
  n.id, n.type, n.data, n.read_at AS "readAt", n.created_at AS "createdAt",
  a.id AS "actorId", a.username AS "actorUsername", a.display_name AS "actorDisplayName"`;

export function mapNotification(r: NotificationRow) {
  return {
    id: r.id,
    type: r.type,
    data: r.data,
    readAt: r.readAt,
    createdAt: r.createdAt,
    actor: r.actorId
      ? { id: r.actorId, username: r.actorUsername, displayName: r.actorDisplayName }
      : null,
  };
}

/** Persists a notification and pushes it to the user in real time if they are online. */
export async function notify(
  userId: string,
  type: NotificationType,
  actorId: string | null,
  data: Record<string, unknown> = {}
) {
  const { rows } = await pool.query<NotificationRow>(
    `WITH n AS (
       INSERT INTO notifications (user_id, type, actor_id, data)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING *
     )
     SELECT ${NOTIFICATION_SELECT}
     FROM n LEFT JOIN users a ON a.id = n.actor_id`,
    [userId, type, actorId, JSON.stringify(data)]
  );
  const notification = mapNotification(rows[0]);
  emitToUser(userId, "notification:new", notification);
  return notification;
}
