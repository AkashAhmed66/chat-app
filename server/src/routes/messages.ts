import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { pool } from "../db";
import { areFriends } from "../friends-util";
import { emitToUser } from "../realtime";
import { ah, HttpError, uuidSchema, validate } from "../utils";
import { deleteUploadedFile } from "./upload";

const router = Router();
router.use(requireAuth);

const querySchema = z.object({
  before: z.string().regex(/^\d+$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(30),
});

export const MESSAGE_COLUMNS = `
  id::text AS id, sender_id AS "senderId", receiver_id AS "receiverId", body,
  created_at AS "createdAt", delivered_at AS "deliveredAt", read_at AS "readAt",
  type, file_url AS "fileUrl", file_name AS "fileName", file_size AS "fileSize",
  file_mime AS "fileMime", duration,
  is_deleted AS "isDeleted", deleted_at AS "deletedAt"`;

/** Conversation history with one friend, paginated backwards by message id. */
router.get(
  "/:userId",
  ah(async (req, res) => {
    const me = req.user!.id;
    const other = validate(uuidSchema, req.params.userId);
    const { before, limit } = validate(querySchema, req.query);
    if (!(await areFriends(me, other))) throw new HttpError(403, "You can only chat with friends");

    // Check if chat is password protected and active
    const lockCheck = await pool.query<{ status: string; password_hash: string }>(
      `SELECT status, password_hash FROM chat_locks
       WHERE LEAST(user1_id, user2_id) = LEAST($1::uuid, $2::uuid)
         AND GREATEST(user1_id, user2_id) = GREATEST($1::uuid, $2::uuid)
         AND status = 'active'`,
      [me, other]
    );

    if (lockCheck.rows.length > 0) {
      const lock = lockCheck.rows[0];
      const providedPassword = req.headers["x-chat-lock-password"] as string | undefined;
      if (!providedPassword || !(await bcrypt.compare(providedPassword, lock.password_hash))) {
        throw new HttpError(423, "Chat is locked. Password required to access messages.");
      }
    }

    const { rows } = await pool.query(
      `SELECT ${MESSAGE_COLUMNS} FROM messages
       WHERE LEAST(sender_id, receiver_id) = LEAST($1::uuid, $2::uuid)
         AND GREATEST(sender_id, receiver_id) = GREATEST($1::uuid, $2::uuid)
         AND ($3::bigint IS NULL OR id < $3::bigint)
       ORDER BY id DESC LIMIT $4`,
      [me, other, before ?? null, limit + 1]
    );
    res.json({ messages: rows.slice(0, limit).reverse(), hasMore: rows.length > limit });
  })
);

/** Delete complete chat: purges all messages, files, calls, and chat locks for both users */
router.delete(
  "/conversation/:userId",
  ah(async (req, res) => {
    const me = req.user!.id;
    const other = validate(uuidSchema, req.params.userId);
    if (!(await areFriends(me, other))) throw new HttpError(403, "You can only manage chats with friends");

    // 1. Delete all attached files from the server's filesystem
    const { rows: files } = await pool.query<{ file_url: string }>(
      `SELECT file_url FROM messages
       WHERE LEAST(sender_id, receiver_id) = LEAST($1::uuid, $2::uuid)
         AND GREATEST(sender_id, receiver_id) = GREATEST($1::uuid, $2::uuid)
         AND file_url IS NOT NULL`,
      [me, other]
    );

    for (const f of files) {
      await deleteUploadedFile(f.file_url);
    }

    // 2. Delete all call history between these two users
    await pool.query(
      `DELETE FROM calls
       WHERE (caller_id = $1 AND callee_id = $2)
          OR (caller_id = $2 AND callee_id = $1)`,
      [me, other]
    );

    // 3. Delete chat password locks between these two users
    await pool.query(
      `DELETE FROM chat_locks
       WHERE LEAST(user1_id, user2_id) = LEAST($1::uuid, $2::uuid)
         AND GREATEST(user1_id, user2_id) = GREATEST($1::uuid, $2::uuid)`,
      [me, other]
    );

    // 4. Delete notifications between these users
    await pool.query(
      `DELETE FROM notifications
       WHERE (user_id = $1 AND actor_id = $2)
          OR (user_id = $2 AND actor_id = $1)`,
      [me, other]
    );

    // 5. Delete all messages between these two users
    await pool.query(
      `DELETE FROM messages
       WHERE LEAST(sender_id, receiver_id) = LEAST($1::uuid, $2::uuid)
         AND GREATEST(sender_id, receiver_id) = GREATEST($1::uuid, $2::uuid)`,
      [me, other]
    );

    // 6. Insert a system notice message stating the complete chat was deleted
    const tombstone = await pool.query(
      `INSERT INTO messages (sender_id, receiver_id, body, type, delivered_at)
       VALUES ($1, $2, 'This chat was deleted', 'chat_deleted', now())
       RETURNING ${MESSAGE_COLUMNS}`,
      [me, other]
    );
    const noticeMessage = tombstone.rows[0];

    // 7. Emit real-time events to both users
    emitToUser(other, "chat:cleared", {
      friendId: me,
      deletedBy: req.user!.displayName,
      message: noticeMessage,
    });
    emitToUser(me, "chat:cleared", {
      friendId: other,
      deletedBy: req.user!.displayName,
      message: noticeMessage,
    });
    emitToUser(other, "chat_lock:update", { friendId: me, status: "none" });
    emitToUser(me, "chat_lock:update", { friendId: other, status: "none" });

    res.json({ ok: true, message: noticeMessage });
  })
);

/** Delete a single message for both users */
router.delete(
  "/:messageId",
  ah(async (req, res) => {
    const me = req.user!.id;
    const messageId = req.params.messageId;
    if (!/^\d+$/.test(messageId)) throw new HttpError(400, "Invalid message ID");

    // Fetch message and ensure user is a participant
    const { rows } = await pool.query<{
      id: string;
      sender_id: string;
      receiver_id: string;
      file_url: string | null;
      is_deleted: boolean;
    }>(
      `SELECT id, sender_id, receiver_id, file_url, is_deleted
       FROM messages
       WHERE id = $1 AND (sender_id = $2 OR receiver_id = $2)`,
      [messageId, me]
    );

    const msg = rows[0];
    if (!msg) throw new HttpError(404, "Message not found or not permitted to delete");

    // If message had an uploaded file, delete it from the server
    if (msg.file_url) {
      await deleteUploadedFile(msg.file_url);
    }

    // Mark as deleted for both users, purge body and file metadata
    const updated = await pool.query(
      `UPDATE messages
       SET is_deleted = true,
           type = 'deleted',
           body = 'This message was deleted',
           file_url = NULL,
           file_name = NULL,
           file_size = NULL,
           file_mime = NULL,
           deleted_at = now(),
           deleted_by = $1
       WHERE id = $2
       RETURNING ${MESSAGE_COLUMNS}`,
      [me, messageId]
    );

    const deletedMessage = updated.rows[0];

    // Emit real-time update to both sender and receiver
    emitToUser(deletedMessage.senderId, "message:deleted", {
      id: deletedMessage.id,
      message: deletedMessage,
    });
    emitToUser(deletedMessage.receiverId, "message:deleted", {
      id: deletedMessage.id,
      message: deletedMessage,
    });

    res.json({ ok: true, message: deletedMessage });
  })
);

export default router;
