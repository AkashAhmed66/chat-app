export interface User {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  bio?: string | null;
  createdAt?: string;
}

export type Relationship = "none" | "friend" | "outgoing" | "incoming";

export interface DirectoryUser extends User {
  relationship: Relationship;
  friendshipId: string | null;
  online: boolean;
}

export interface Friend extends User {
  friendshipId: string;
  unread: number;
  lastMessage: {
    body: string;
    type?: string;
    fileName?: string | null;
    at: string;
    senderId: string;
  } | null;
}

export interface FriendRequest {
  id: string;
  createdAt: string;
  user: User;
}

export type MessageType = "text" | "image" | "video" | "file" | "call_log" | "deleted" | "chat_deleted";

export interface ChatMessage {
  id: string;
  senderId: string;
  receiverId: string;
  body: string;
  createdAt: string;
  deliveredAt: string | null;
  readAt: string | null;
  type?: MessageType;
  fileUrl?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  fileMime?: string | null;
  duration?: number | null;
  isDeleted?: boolean;
  deletedAt?: string | null;
  /** client-only flags for optimistic sends */
  pending?: boolean;
  failed?: boolean;
}

export type NotificationType = "friend_request" | "friend_accepted" | "missed_call";

export interface AppNotification {
  id: string;
  type: NotificationType;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
  actor: User | null;
}

export type CallType = "audio" | "video";

export interface CallRecord {
  id: string;
  callerId: string;
  calleeId: string;
  type: CallType;
  status: "ringing" | "accepted" | "rejected" | "missed" | "cancelled" | "ended";
  createdAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  duration: number;
  isCaller: boolean;
  peer: User;
}

export interface ChatLockStatus {
  status: "none" | "requested" | "active";
  isRequester: boolean;
  requesterName?: string | null;
}

/** Shape of every socket.io acknowledgement from the server. */
export type Ack<T = Record<string, never>> =
  | ({ ok: true } & T)
  | { ok: false; error: string };
