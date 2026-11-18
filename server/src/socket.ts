import { parse as parseCookie } from "cookie";
import type { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { z } from "zod";
import { AuthUser, COOKIE_NAME, getUserById, verifyToken } from "./auth";
import { config } from "./config";
import { pool } from "./db";
import { areFriends } from "./friends-util";
import { createCallToken, livekitPublicUrl } from "./livekit";
import { MESSAGE_COLUMNS } from "./routes/messages";
import { deleteUploadedFile } from "./routes/upload";
import { notify } from "./notifications";
import {
  addPresence,
  emitToUser,
  getOnlineIds,
  isOnline,
  removePresence,
  setIO,
  userRoom,
} from "./realtime";
import { UserError, uuidSchema } from "./utils";

type Ack = (response: Record<string, unknown>) => void;
type CallType = "audio" | "video";

interface CallRow {
  id: string;
  callerId: string;
  calleeId: string;
  type: CallType;
  status: string;
}

const CALL_COLUMNS = `id, caller_id AS "callerId", callee_id AS "calleeId", type, status`;

// callId -> timer that marks an unanswered call as missed
const ringTimers = new Map<string, NodeJS.Timeout>();
// userId -> timer that cleans up after the user's last connection dropped
const offlineTimers = new Map<string, NodeJS.Timeout>();

/** Registers an event with validation, ack handling and error mapping. */
function handle<S extends z.ZodTypeAny>(
  socket: Socket,
  event: string,
  schema: S,
  fn: (data: z.infer<S>) => Promise<Record<string, unknown> | void>
) {
  socket.on(event, async (payload: unknown, ack?: unknown) => {
    const cb: Ack = typeof ack === "function" ? (ack as Ack) : () => undefined;
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return cb({ ok: false, error: "Invalid request" });
    try {
      const result = await fn(parsed.data);
      cb({ ok: true, ...(result ?? {}) });
    } catch (err) {
      if (err instanceof UserError) return cb({ ok: false, error: err.message });
      console.error(`Socket handler "${event}" failed`, err);
      cb({ ok: false, error: "Something went wrong" });
    }
  });
}

export function initSocket(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: { origin: config.clientOrigins, credentials: true },
    maxHttpBufferSize: 64 * 1024,
  });
  setIO(io);

  // Authenticate with the same httpOnly cookie used by the REST API.
  io.use(async (socket, next) => {
    try {
      const raw = socket.handshake.headers.cookie;
      const token = raw ? parseCookie(raw)[COOKIE_NAME] : undefined;
      const userId = token ? verifyToken(token) : null;
      const user = userId ? await getUserById(userId) : null;
      if (!user) return next(new Error("unauthorized"));
      socket.data.user = user;
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => onConnection(io, socket));
  return io;
}

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------

function onConnection(io: Server, socket: Socket) {
  const me = socket.data.user as AuthUser;
  socket.join(userRoom(me.id));

  const pendingOffline = offlineTimers.get(me.id);
  if (pendingOffline) {
    clearTimeout(pendingOffline);
    offlineTimers.delete(me.id);
  }

  const first = addPresence(me.id, socket.id);
  socket.emit("presence:init", { onlineIds: getOnlineIds() });
  if (first) {
    io.emit("presence:update", { userId: me.id, online: true });
  }
  void markDelivered(me.id);

  registerMessageHandlers(socket, me);
  registerCallHandlers(socket, me);

  socket.on("disconnect", () => {
    const nowOffline = removePresence(me.id, socket.id);
    if (!nowOffline) return;
    // Small grace period so a page refresh does not kill an active call.
    const timer = setTimeout(() => {
      offlineTimers.delete(me.id);
      if (isOnline(me.id)) return;
      io.emit("presence:update", { userId: me.id, online: false });
      pool
        .query("UPDATE users SET last_seen_at = now() WHERE id = $1", [me.id])
        .catch((e) => console.error(e));
      endCallsForOfflineUser(me.id).catch((e) => console.error(e));
    }, config.offlineGraceMs);
    offlineTimers.set(me.id, timer);
  });
}

/** Messages that arrived while I was offline are now delivered. */
async function markDelivered(userId: string) {
  const { rows } = await pool.query<{ id: string; senderId: string }>(
    `UPDATE messages SET delivered_at = now()
     WHERE receiver_id = $1 AND delivered_at IS NULL
     RETURNING id::text AS id, sender_id AS "senderId"`,
    [userId]
  );
  const bySender = new Map<string, string[]>();
  for (const r of rows) bySender.set(r.senderId, [...(bySender.get(r.senderId) ?? []), r.id]);
  for (const [senderId, ids] of bySender) {
    emitToUser(senderId, "message:delivered", { receiverId: userId, ids });
  }
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

function registerMessageHandlers(socket: Socket, me: AuthUser) {
  // Simple per-socket rate limit: 20 messages per 10 seconds.
  let windowStart = 0;
  let windowCount = 0;

  handle(
    socket,
    "message:send",
    z.object({
      to: uuidSchema,
      body: z.string().max(4000).optional().default(""),
      type: z.enum(["text", "image", "video", "file", "call_log"]).optional().default("text"),
      fileUrl: z.string().optional().nullable(),
      fileName: z.string().optional().nullable(),
      fileSize: z.number().int().optional().nullable(),
      fileMime: z.string().optional().nullable(),
      duration: z.number().int().optional().nullable(),
    }),
    async ({ to, body, type, fileUrl, fileName, fileSize, fileMime, duration }) => {
      const now = Date.now();
      if (now - windowStart > 10_000) {
        windowStart = now;
        windowCount = 0;
      }
      if (++windowCount > 20) throw new UserError("You are sending messages too fast");

      if (!(await areFriends(me.id, to))) throw new UserError("You can only message friends");

      const cleanBody = (body ?? "").trim();
      if (type === "text" && !cleanBody) {
        throw new UserError("Message body cannot be empty");
      }
      if (["image", "video", "file"].includes(type) && !fileUrl) {
        throw new UserError("File attachment is missing");
      }

      const delivered = isOnline(to);
      const { rows } = await pool.query(
        `INSERT INTO messages (sender_id, receiver_id, body, type, file_url, file_name, file_size, file_mime, duration, delivered_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $10::boolean THEN now() ELSE NULL END)
         RETURNING ${MESSAGE_COLUMNS}`,
        [me.id, to, cleanBody, type, fileUrl ?? null, fileName ?? null, fileSize ?? null, fileMime ?? null, duration ?? 0, delivered]
      );
      const message = rows[0];
      emitToUser(to, "message:new", message);
      // Keep my other tabs/devices in sync (not this socket - it gets the ack).
      socket.to(userRoom(me.id)).emit("message:self", message);
      return { message };
    }
  );

  handle(socket, "message:read", z.object({ from: uuidSchema }), async ({ from }) => {
    const { rows } = await pool.query<{ id: string }>(
      `UPDATE messages SET read_at = now(), delivered_at = COALESCE(delivered_at, now())
       WHERE sender_id = $1 AND receiver_id = $2 AND read_at IS NULL
       RETURNING id::text AS id`,
      [from, me.id]
    );
    if (rows.length) {
      emitToUser(from, "message:read", { readerId: me.id, ids: rows.map((r) => r.id) });
    }
    socket.to(userRoom(me.id)).emit("conversation:read", { userId: from });
  });

  handle(
    socket,
    "message:delete",
    z.object({ messageId: z.string() }),
    async ({ messageId }) => {
      if (!/^\d+$/.test(messageId)) throw new UserError("Invalid message ID");

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
        [messageId, me.id]
      );

      const msg = rows[0];
      if (!msg) throw new UserError("Message not found or not permitted to delete");

      if (msg.file_url) {
        await deleteUploadedFile(msg.file_url);
      }

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
        [me.id, messageId]
      );

      const deletedMessage = updated.rows[0];

      emitToUser(deletedMessage.senderId, "message:deleted", {
        id: deletedMessage.id,
        message: deletedMessage,
      });
      emitToUser(deletedMessage.receiverId, "message:deleted", {
        id: deletedMessage.id,
        message: deletedMessage,
      });

      return { message: deletedMessage };
    }
  );

  handle(
    socket,
    "chat:clear",
    z.object({ to: uuidSchema }),
    async ({ to }) => {
      if (!(await areFriends(me.id, to))) throw new UserError("You can only manage chats with friends");

      // 1. Delete all attached files
      const { rows: files } = await pool.query<{ file_url: string }>(
        `SELECT file_url FROM messages
         WHERE LEAST(sender_id, receiver_id) = LEAST($1::uuid, $2::uuid)
           AND GREATEST(sender_id, receiver_id) = GREATEST($1::uuid, $2::uuid)
           AND file_url IS NOT NULL`,
        [me.id, to]
      );
      for (const f of files) {
        await deleteUploadedFile(f.file_url);
      }

      // 2. Delete calls
      await pool.query(
        `DELETE FROM calls
         WHERE (caller_id = $1 AND callee_id = $2)
            OR (caller_id = $2 AND callee_id = $1)`,
        [me.id, to]
      );

      // 3. Delete chat locks
      await pool.query(
        `DELETE FROM chat_locks
         WHERE LEAST(user1_id, user2_id) = LEAST($1::uuid, $2::uuid)
           AND GREATEST(user1_id, user2_id) = GREATEST($1::uuid, $2::uuid)`,
        [me.id, to]
      );

      // 4. Delete notifications
      await pool.query(
        `DELETE FROM notifications
         WHERE (user_id = $1 AND actor_id = $2)
            OR (user_id = $2 AND actor_id = $1)`,
        [me.id, to]
      );

      // 5. Delete messages
      await pool.query(
        `DELETE FROM messages
         WHERE LEAST(sender_id, receiver_id) = LEAST($1::uuid, $2::uuid)
           AND GREATEST(sender_id, receiver_id) = GREATEST($1::uuid, $2::uuid)`,
        [me.id, to]
      );

      // 6. Insert tombstone notice
      const tombstone = await pool.query(
        `INSERT INTO messages (sender_id, receiver_id, body, type, delivered_at)
         VALUES ($1, $2, 'This chat was deleted', 'chat_deleted', now())
         RETURNING ${MESSAGE_COLUMNS}`,
        [me.id, to]
      );
      const noticeMessage = tombstone.rows[0];

      // 7. Emit real-time events to both users
      emitToUser(to, "chat:cleared", {
        friendId: me.id,
        deletedBy: me.displayName,
        message: noticeMessage,
      });
      emitToUser(me.id, "chat:cleared", {
        friendId: to,
        deletedBy: me.displayName,
        message: noticeMessage,
      });
      emitToUser(to, "chat_lock:update", { friendId: me.id, status: "none" });
      emitToUser(me.id, "chat_lock:update", { friendId: to, status: "none" });

      return { message: noticeMessage };
    }
  );

  handle(
    socket,
    "typing",
    z.object({ to: uuidSchema, isTyping: z.boolean() }),
    async ({ to, isTyping }) => {
      if (!isOnline(to) || !(await areFriends(me.id, to))) return;
      emitToUser(to, "typing", { userId: me.id, isTyping });
    }
  );
}

// ---------------------------------------------------------------------------
// Calls
//
// Signalling flow (media itself flows through LiveKit):
//   caller  --call:start-->     server --call:incoming--> callee
//   callee  --call:delivered--> server --call:ringing-->  caller   (delivery receipt)
//   callee  --call:accept-->    server --call:accepted--> caller   (+ LiveKit tokens)
//   callee  --call:reject-->    server --call:rejected--> caller
//   caller  --call:cancel-->    server --call:cancelled-> callee   (+ missed-call notification)
//   either  --call:end-->       server --call:ended-->    other
//   no answer within ringTimeoutMs -> call:missed / call:cancelled + notification
// ---------------------------------------------------------------------------

async function hasActiveCall(userId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM calls
     WHERE status IN ('ringing', 'accepted') AND (caller_id = $1 OR callee_id = $1) LIMIT 1`,
    [userId]
  );
  return (rowCount ?? 0) > 0;
}

function clearRingTimer(callId: string) {
  const t = ringTimers.get(callId);
  if (t) clearTimeout(t);
  ringTimers.delete(callId);
}

async function recordMissedCall(call: Pick<CallRow, "callerId" | "calleeId" | "type" | "id">) {
  await notify(call.calleeId, "missed_call", call.callerId, {
    callId: call.id,
    callType: call.type,
  });
  try {
    const { rows } = await pool.query(
      `INSERT INTO messages (sender_id, receiver_id, body, type, file_name, duration, delivered_at)
       VALUES ($1, $2, $3, 'call_log', 'missed', 0, now())
       RETURNING ${MESSAGE_COLUMNS}`,
      [call.callerId, call.calleeId, `Missed ${call.type} call`]
    );
    if (rows[0]) {
      emitToUser(call.callerId, "message:new", rows[0]);
      emitToUser(call.calleeId, "message:new", rows[0]);
    }
  } catch (err) {
    console.error("Failed to log missed call message:", err);
  }
}

function startRingTimer(callId: string) {
  clearRingTimer(callId);
  ringTimers.set(
    callId,
    setTimeout(async () => {
      ringTimers.delete(callId);
      try {
        const { rows } = await pool.query<CallRow>(
          `UPDATE calls SET status = 'missed', ended_at = now()
           WHERE id = $1 AND status = 'ringing' RETURNING ${CALL_COLUMNS}`,
          [callId]
        );
        const call = rows[0];
        if (!call) return;
        emitToUser(call.callerId, "call:missed", { callId });
        emitToUser(call.calleeId, "call:cancelled", { callId });
        await recordMissedCall(call);
      } catch (err) {
        console.error("Ring timeout failed", err);
      }
    }, config.ringTimeoutMs)
  );
}

function registerCallHandlers(socket: Socket, me: AuthUser) {
  handle(
    socket,
    "call:start",
    z.object({ to: uuidSchema, type: z.enum(["audio", "video"]) }),
    async ({ to, type }) => {
      if (to === me.id) throw new UserError("You cannot call yourself");
      if (!(await areFriends(me.id, to))) throw new UserError("You can only call friends");
      if (await hasActiveCall(me.id)) throw new UserError("You are already in a call");

      const target = await pool.query<{ displayName: string }>(
        `SELECT display_name AS "displayName" FROM users WHERE id = $1`,
        [to]
      );
      const targetName = target.rows[0]?.displayName ?? "User";

      if (!isOnline(to)) {
        // Offline: log it and leave a missed-call notification for when they return.
        const { rows } = await pool.query<CallRow>(
          `INSERT INTO calls (caller_id, callee_id, type, status, ended_at)
           VALUES ($1, $2, $3, 'missed', now()) RETURNING ${CALL_COLUMNS}`,
          [me.id, to, type]
        );
        await recordMissedCall(rows[0]);
        throw new UserError(`${targetName} is offline`);
      }
      if (await hasActiveCall(to)) throw new UserError(`${targetName} is busy on another call`);

      const { rows } = await pool.query<CallRow>(
        `INSERT INTO calls (caller_id, callee_id, type) VALUES ($1, $2, $3) RETURNING ${CALL_COLUMNS}`,
        [me.id, to, type]
      );
      const call = rows[0];
      startRingTimer(call.id);
      emitToUser(to, "call:incoming", {
        callId: call.id,
        type,
        from: { id: me.id, username: me.username, displayName: me.displayName },
      });
      return { callId: call.id };
    }
  );

  // Callee's device confirms the incoming call reached it -> caller sees "Ringing".
  handle(socket, "call:delivered", z.object({ callId: uuidSchema }), async ({ callId }) => {
    const { rows } = await pool.query<CallRow>(
      `SELECT ${CALL_COLUMNS} FROM calls WHERE id = $1`,
      [callId]
    );
    const call = rows[0];
    if (call && call.calleeId === me.id && call.status === "ringing") {
      emitToUser(call.callerId, "call:ringing", { callId });
    }
  });

  handle(
    socket,
    "call:accept",
    z.object({ callId: uuidSchema, mode: z.enum(["audio", "video"]) }),
    async ({ callId, mode }) => {
      const { rows } = await pool.query<CallRow>(
        `UPDATE calls SET status = 'accepted', answered_at = now()
         WHERE id = $1 AND callee_id = $2 AND status = 'ringing'
         RETURNING ${CALL_COLUMNS}`,
        [callId, me.id]
      );
      const call = rows[0];
      if (!call) throw new UserError("This call is no longer available");
      clearRingTimer(callId);

      // An audio call can only be answered as audio.
      const effectiveMode: CallType = call.type === "audio" ? "audio" : mode;

      const caller = await getUserById(call.callerId);
      if (!caller) throw new UserError("Caller no longer exists");

      const [calleeToken, callerToken] = await Promise.all([
        createCallToken(callId, me),
        createCallToken(callId, caller),
      ]);

      emitToUser(call.callerId, "call:accepted", {
        callId,
        token: callerToken,
        serverUrl: livekitPublicUrl(),
        acceptedMode: effectiveMode,
      });
      // Dismiss the ringing UI on my other devices.
      socket.to(userRoom(me.id)).emit("call:handled", { callId });

      return { token: calleeToken, serverUrl: livekitPublicUrl(), mode: effectiveMode, type: call.type };
    }
  );

  handle(socket, "call:reject", z.object({ callId: uuidSchema }), async ({ callId }) => {
    const { rows } = await pool.query<CallRow>(
      `UPDATE calls SET status = 'rejected', ended_at = now()
       WHERE id = $1 AND callee_id = $2 AND status = 'ringing'
       RETURNING ${CALL_COLUMNS}`,
      [callId, me.id]
    );
    const call = rows[0];
    if (!call) return;
    clearRingTimer(callId);
    emitToUser(call.callerId, "call:rejected", { callId });
    socket.to(userRoom(me.id)).emit("call:handled", { callId });
  });

  handle(socket, "call:cancel", z.object({ callId: uuidSchema }), async ({ callId }) => {
    const { rows } = await pool.query<CallRow>(
      `UPDATE calls SET status = 'cancelled', ended_at = now()
       WHERE id = $1 AND caller_id = $2 AND status = 'ringing'
       RETURNING ${CALL_COLUMNS}`,
      [callId, me.id]
    );
    const call = rows[0];
    if (!call) return;
    clearRingTimer(callId);
    emitToUser(call.calleeId, "call:cancelled", { callId });
    await recordMissedCall(call);
  });

  // Idempotent: both sides may report the end of the same call.
  handle(socket, "call:end", z.object({ callId: uuidSchema }), async ({ callId }) => {
    const { rows } = await pool.query<CallRow & { duration: number }>(
      `UPDATE calls
       SET status = 'ended', ended_at = now(),
           duration = CASE WHEN answered_at IS NOT NULL THEN GREATEST(0, EXTRACT(EPOCH FROM (now() - answered_at))::int) ELSE 0 END
       WHERE id = $1 AND status = 'accepted' AND (caller_id = $2 OR callee_id = $2)
       RETURNING ${CALL_COLUMNS}, duration`,
      [callId, me.id]
    );
    const call = rows[0];
    if (!call) return;
    const peerId = call.callerId === me.id ? call.calleeId : call.callerId;
    emitToUser(peerId, "call:ended", { callId, duration: call.duration });
    socket.to(userRoom(me.id)).emit("call:ended", { callId, duration: call.duration });

    // Also record call in chat history as a call_log message
    try {
      const callMsg = await pool.query(
        `INSERT INTO messages (sender_id, receiver_id, body, type, file_name, duration, delivered_at)
         VALUES ($1, $2, $3, 'call_log', 'ended', $4, now())
         RETURNING ${MESSAGE_COLUMNS}`,
        [call.callerId, call.calleeId, call.type === "video" ? "Video call" : "Audio call", call.duration]
      );
      if (callMsg.rows[0]) {
        emitToUser(call.callerId, "message:new", callMsg.rows[0]);
        emitToUser(call.calleeId, "message:new", callMsg.rows[0]);
      }
    } catch (e) {
      console.error("Failed to log call message", e);
    }
  });
}

/** A user dropped offline: hang up their active calls so the other side is not left hanging. */
async function endCallsForOfflineUser(userId: string) {
  const { rows } = await pool.query<CallRow & { answered: boolean; duration: number }>(
    `UPDATE calls
     SET status = CASE WHEN status = 'accepted' THEN 'ended' ELSE 'cancelled' END,
         ended_at = now(),
         duration = CASE WHEN answered_at IS NOT NULL THEN GREATEST(0, EXTRACT(EPOCH FROM (now() - answered_at))::int) ELSE 0 END
     WHERE (status = 'accepted' AND (caller_id = $1 OR callee_id = $1))
        OR (status = 'ringing' AND caller_id = $1)
     RETURNING ${CALL_COLUMNS}, answered_at IS NOT NULL AS answered, duration`,
    [userId]
  );
  for (const call of rows) {
    clearRingTimer(call.id);
    const peerId = call.callerId === userId ? call.calleeId : call.callerId;
    if (call.answered) {
      emitToUser(peerId, "call:ended", { callId: call.id, reason: "disconnected", duration: call.duration });
      try {
        const callMsg = await pool.query(
          `INSERT INTO messages (sender_id, receiver_id, body, type, file_name, duration, delivered_at)
           VALUES ($1, $2, $3, 'call_log', 'ended', $4, now())
           RETURNING ${MESSAGE_COLUMNS}`,
          [call.callerId, call.calleeId, call.type === "video" ? "Video call" : "Audio call", call.duration]
        );
        if (callMsg.rows[0]) {
          emitToUser(call.callerId, "message:new", callMsg.rows[0]);
          emitToUser(call.calleeId, "message:new", callMsg.rows[0]);
        }
      } catch (e) {
        console.error("Failed to log disconnected call message", e);
      }
    } else {
      emitToUser(peerId, "call:cancelled", { callId: call.id });
      await recordMissedCall(call);
    }
  }
}
