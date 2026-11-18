import type { Server } from "socket.io";

let io: Server | null = null;

// userId -> set of socket ids (a user may be connected from several tabs/devices)
const connections = new Map<string, Set<string>>();

export const userRoom = (userId: string) => `user:${userId}`;

export function setIO(server: Server): void {
  io = server;
}

export function getIO(): Server {
  if (!io) throw new Error("Socket.IO not initialised");
  return io;
}

export function emitToUser(userId: string, event: string, payload?: unknown): void {
  io?.to(userRoom(userId)).emit(event, payload);
}

/** Returns true when this is the user's first live connection. */
export function addPresence(userId: string, socketId: string): boolean {
  let set = connections.get(userId);
  if (!set) {
    set = new Set();
    connections.set(userId, set);
  }
  const first = set.size === 0;
  set.add(socketId);
  return first;
}

/** Returns true when the user has no live connections left. */
export function removePresence(userId: string, socketId: string): boolean {
  const set = connections.get(userId);
  if (!set) return true;
  set.delete(socketId);
  if (set.size === 0) {
    connections.delete(userId);
    return true;
  }
  return false;
}

export const isOnline = (userId: string) => (connections.get(userId)?.size ?? 0) > 0;
export const getOnlineIds = () => Array.from(connections.keys());
