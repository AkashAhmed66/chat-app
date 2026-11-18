"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { API_URL } from "@/lib/config";
import { formatDateOrTime, formatDuration, formatFileSize, formatMediaUrl, formatTime } from "@/lib/format";
import type { Ack, ChatLockStatus, ChatMessage, Friend } from "@/lib/types";
import { useAuth } from "./AuthProvider";
import Avatar from "./Avatar";
import { useCall } from "./CallProvider";
import ChatLockModal from "./ChatLockModal";
import EmojiPicker from "./EmojiPicker";
import {
  AlertIcon,
  ArrowLeftIcon,
  BanIcon,
  CheckCheckIcon,
  CheckIcon,
  ClockIcon,
  DownloadIcon,
  FileIcon,
  LockIcon,
  MessageIcon,
  PaperclipIcon,
  PhoneIcon,
  ShieldIcon,
  SmileIcon,
  TrashIcon,
  UnlockIcon,
  VideoIcon,
  XIcon,
} from "./Icons";
import ImageLightbox from "./ImageLightbox";
import { useRealtime } from "./RealtimeProvider";
import UserProfileModal from "./UserProfileModal";

interface HistoryResponse {
  messages: ChatMessage[];
  hasMore: boolean;
}

type SendAck = Ack<{ message: ChatMessage }>;

/**
 * Deduplicates messages by id and sorts by numeric id ascending.
 * Temporary (optimistic) messages (id starts with "tmp-") are placed at the end,
 * sorted by createdAt as a fallback.
 */
function dedupeAndSort(msgs: ChatMessage[]): ChatMessage[] {
  const map = new Map<string, ChatMessage>();
  for (const m of msgs) {
    // If a real message replaces a temp one (same content), the real one wins.
    // Otherwise, later entries (real-time) overwrite earlier ones (from fetch).
    map.set(m.id, m);
  }
  return Array.from(map.values()).sort((a, b) => {
    const aIsTemp = a.id.startsWith("tmp-");
    const bIsTemp = b.id.startsWith("tmp-");
    // Temp messages always go to end
    if (aIsTemp && !bIsTemp) return 1;
    if (!aIsTemp && bIsTemp) return -1;
    if (aIsTemp && bIsTemp) {
      // Both temp: sort by createdAt
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    }
    // Both real: sort by numeric id (bigserial)
    return Number(a.id) - Number(b.id);
  });
}

function Ticks({ m }: { m: ChatMessage }) {
  if (m.failed)
    return (
      <span className="tick tick-failed" title="Failed to send">
        <AlertIcon size={13} />
        Failed
      </span>
    );
  if (m.pending)
    return (
      <span className="tick" title="Sending">
        <ClockIcon size={13} />
      </span>
    );
  if (m.readAt)
    return (
      <span className="tick tick-read" title="Read">
        <CheckCheckIcon size={14} />
      </span>
    );
  if (m.deliveredAt)
    return (
      <span className="tick" title="Delivered">
        <CheckCheckIcon size={14} />
      </span>
    );
  return (
    <span className="tick" title="Sent">
      <CheckIcon size={14} />
    </span>
  );
}

export default function ChatWindow({
  friend,
  onBack,
  onSent,
}: {
  friend: Friend;
  onBack: () => void;
  onSent: (message: ChatMessage) => void;
}) {
  const { user } = useAuth();
  const { socket, onlineIds, pushToast } = useRealtime();
  const { busy, startCall } = useCall();
  const online = onlineIds.has(friend.id);

  // Messages state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [text, setText] = useState("");
  const [peerTyping, setPeerTyping] = useState(false);

  // Chat lock state
  const [lockStatus, setLockStatus] = useState<ChatLockStatus>({
    status: "none",
    isRequester: false,
    requesterName: null,
  });
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [showLockModal, setShowLockModal] = useState(false);

  // Modals & UI states
  const [showUserProfile, setShowUserProfile] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [messageToDelete, setMessageToDelete] = useState<string | null>(null);
  const [showClearChatModal, setShowClearChatModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Attachment state
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);

  // Refs for scrolling and pagination
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const initialScrollDone = useRef(false);
  const scrollAdjustRef = useRef<{ prevHeight: number; prevTop: number } | null>(null);
  const tempCounter = useRef(0);
  const typingSent = useRef(false);
  const typingStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peerTypingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Scroll to bottom helper
  const scrollToBottom = useCallback((instant = true) => {
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({
        behavior: instant ? "auto" : "smooth",
        block: "end",
      });
    }
  }, []);

  // Reset state when active friend changes
  useEffect(() => {
    setMessages([]);
    setHasMore(false);
    setLoading(true);
    initialScrollDone.current = false;
    stickToBottom.current = true;
    setText("");
    setPendingFile(null);
    setFilePreview(null);
  }, [friend.id]);

  // Check session storage for existing unlock
  const cachedPassword = typeof window !== "undefined"
    ? sessionStorage.getItem(`chat_unlock_${friend.id}`)
    : null;

  const markRead = useCallback(() => {
    if (!socket || document.hidden) return;
    socket.emit("message:read", { from: friend.id });
  }, [socket, friend.id]);

  // Load chat lock status
  const loadLockStatus = useCallback(async () => {
    try {
      const res = await api<ChatLockStatus>(`/api/chat-lock/${friend.id}`);
      setLockStatus(res);
      if (res.status !== "active") {
        setIsUnlocked(true);
      } else if (cachedPassword) {
        // Try verifying with cached session password
        try {
          await api(`/api/chat-lock/${friend.id}/verify`, {
            method: "POST",
            body: { password: cachedPassword },
          });
          setIsUnlocked(true);
        } catch {
          sessionStorage.removeItem(`chat_unlock_${friend.id}`);
          setIsUnlocked(false);
        }
      } else {
        setIsUnlocked(false);
      }
    } catch {
      setIsUnlocked(true);
    }
  }, [friend.id, cachedPassword]);

  useEffect(() => {
    void loadLockStatus();
  }, [loadLockStatus]);

  // Load initial messages once unlocked
  const loadInitialMessages = useCallback(async () => {
    if (!isUnlocked) return;
    setLoading(true);
    initialScrollDone.current = false;
    try {
      const pwd = sessionStorage.getItem(`chat_unlock_${friend.id}`) || unlockPassword;
      const headers = pwd ? { "x-chat-lock-password": pwd } : undefined;

      const res = await fetch(`${API_URL}/api/messages/${friend.id}?limit=20`, {
        credentials: "include",
        headers,
      });

      if (res.status === 423) {
        setIsUnlocked(false);
        return;
      }
      if (!res.ok) throw new Error("Could not load messages");

      const d: HistoryResponse = await res.json();
      setMessages(dedupeAndSort(d.messages));
      setHasMore(d.hasMore);
      stickToBottom.current = true;
      markRead();
    } catch {
      pushToast("Could not load messages", "error");
    } finally {
      setLoading(false);
    }
  }, [friend.id, isUnlocked, markRead, pushToast, unlockPassword]);

  useEffect(() => {
    if (isUnlocked) {
      void loadInitialMessages();
    }
  }, [isUnlocked, loadInitialMessages]);

  // Handle scroll adjustments & auto-scroll to bottom
  useLayoutEffect(() => {
    if (scrollAdjustRef.current && scrollContainerRef.current) {
      // Prepending older messages: preserve exact scroll offset so the user stays exactly where they were
      const container = scrollContainerRef.current;
      const { prevHeight, prevTop } = scrollAdjustRef.current;
      const delta = container.scrollHeight - prevHeight;
      container.scrollTop = prevTop + delta;
      scrollAdjustRef.current = null;
    } else if (!initialScrollDone.current && !loading && messages.length > 0) {
      // Only snap to bottom on initial load
      scrollToBottom(true);
      initialScrollDone.current = true;
      stickToBottom.current = true;
    } else if (stickToBottom.current) {
      // Only scroll to bottom if user is already at the bottom when a new message arrives
      scrollToBottom(false);
    }
  }, [messages, loading, scrollToBottom]);

  // Scroll listener for loading older messages
  const handleScroll = useCallback(async () => {
    const container = scrollContainerRef.current;
    if (!container) return;

    // Ignore scroll events during initial render before scrolling to bottom is complete
    if (!initialScrollDone.current) return;

    // Check if user is near bottom
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
    stickToBottom.current = atBottom;

    // Check if scrolled near top and should load older messages
    if (container.scrollTop < 80 && hasMore && !loadingOlder && !loading) {
      // Find the message with the smallest numeric id (excluding temp messages)
      const realMessages = messages.filter((m) => !m.pending && !m.id.startsWith("tmp-"));
      if (realMessages.length === 0) return;
      const oldest = realMessages.reduce((min, m) =>
        Number(m.id) < Number(min.id) ? m : min,
        realMessages[0]
      );

      setLoadingOlder(true);

      try {
        const pwd = sessionStorage.getItem(`chat_unlock_${friend.id}`) || unlockPassword;
        const headers = pwd ? { "x-chat-lock-password": pwd } : undefined;

        const res = await fetch(
          `${API_URL}/api/messages/${friend.id}?limit=15&before=${oldest.id}`,
          { credentials: "include", headers }
        );
        if (!res.ok) throw new Error("Failed to load older messages");

        const d: HistoryResponse = await res.json();

        // Capture scroll measurements right before applying messages state
        const c = scrollContainerRef.current;
        if (c) {
          scrollAdjustRef.current = {
            prevHeight: c.scrollHeight,
            prevTop: c.scrollTop,
          };
        }

        setMessages((prev) => dedupeAndSort([...d.messages, ...prev]));
        setHasMore(d.hasMore);
      } catch {
        pushToast("Could not load older messages", "error");
      } finally {
        setLoadingOlder(false);
      }
    }
  }, [friend.id, hasMore, loading, loadingOlder, messages, pushToast, unlockPassword]);

  // Real-time events
  useEffect(() => {
    if (!socket) return;

    const onNew = (m: ChatMessage) => {
      // For regular messages: only accept messages from the friend
      // For call_log: accept if the conversation involves the friend
      // (server emits call_log via message:new to both parties)
      const isForThisChat =
        m.senderId === friend.id ||
        (m.type === "call_log" && (m.senderId === user?.id && m.receiverId === friend.id));
      if (!isForThisChat) return;

      stickToBottom.current = true;
      setMessages((prev) => dedupeAndSort([...prev, m]));
      setPeerTyping(false);
      if (m.senderId === friend.id) markRead();
    };

    const onSelf = (m: ChatMessage) => {
      if (m.receiverId !== friend.id) return;
      stickToBottom.current = true;
      setMessages((prev) => dedupeAndSort([...prev, m]));
    };

    const onRead = ({ readerId, ids }: { readerId: string; ids: string[] }) => {
      if (readerId !== friend.id) return;
      const nowIso = new Date().toISOString();
      setMessages((prev) =>
        prev.map((m) =>
          ids.includes(m.id) ? { ...m, readAt: nowIso, deliveredAt: m.deliveredAt ?? nowIso } : m
        )
      );
    };

    const onDelivered = ({ receiverId, ids }: { receiverId: string; ids: string[] }) => {
      if (receiverId !== friend.id) return;
      const nowIso = new Date().toISOString();
      setMessages((prev) => prev.map((m) => (ids.includes(m.id) ? { ...m, deliveredAt: nowIso } : m)));
    };

    const onTyping = ({ userId, isTyping }: { userId: string; isTyping: boolean }) => {
      if (userId !== friend.id) return;
      setPeerTyping(isTyping);
      if (peerTypingTimer.current) clearTimeout(peerTypingTimer.current);
      if (isTyping) peerTypingTimer.current = setTimeout(() => setPeerTyping(false), 4000);
    };

    const onChatLockUpdate = (data: { friendId: string; status: ChatLockStatus["status"] }) => {
      if (data.friendId === friend.id) {
        void loadLockStatus();
      }
    };

    const onMessageDeleted = (data: { id: string; message: ChatMessage }) => {
      setMessages((prev) =>
        prev.map((m) =>
          String(m.id) === String(data.id)
            ? {
                ...m,
                ...data.message,
                isDeleted: true,
                type: "deleted",
                body: "This message was deleted",
                fileUrl: null,
                fileName: null,
                fileSize: null,
                fileMime: null,
              }
            : m
        )
      );
    };

    const onChatCleared = (data: { friendId: string; deletedBy: string; message: ChatMessage }) => {
      if (data.friendId === friend.id) {
        sessionStorage.removeItem(`chat_unlock_${friend.id}`);
        setLockStatus({ status: "none", isRequester: false, requesterName: null });
        setIsUnlocked(true);
        setMessages(data.message ? [data.message] : []);
        setHasMore(false);
        pushToast(`This chat was deleted by ${data.deletedBy}`, "info");
      }
    };

    const onReconnect = () => {
      void loadLockStatus();
      if (isUnlocked) void loadInitialMessages();
    };

    socket.on("message:new", onNew);
    socket.on("message:self", onSelf);
    socket.on("message:read", onRead);
    socket.on("message:delivered", onDelivered);
    socket.on("message:deleted", onMessageDeleted);
    socket.on("chat:cleared", onChatCleared);
    socket.on("typing", onTyping);
    socket.on("chat_lock:update", onChatLockUpdate);
    socket.io.on("reconnect", onReconnect);

    return () => {
      socket.off("message:new", onNew);
      socket.off("message:self", onSelf);
      socket.off("message:read", onRead);
      socket.off("message:delivered", onDelivered);
      socket.off("message:deleted", onMessageDeleted);
      socket.off("chat:cleared", onChatCleared);
      socket.off("typing", onTyping);
      socket.off("chat_lock:update", onChatLockUpdate);
      socket.io.off("reconnect", onReconnect);
      if (peerTypingTimer.current) clearTimeout(peerTypingTimer.current);
      if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
    };
  }, [socket, friend.id, markRead, loadLockStatus, loadInitialMessages, isUnlocked]);

  // Handle file selection
  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 50 * 1024 * 1024) {
      pushToast("File is too large (max 50MB)", "warning");
      return;
    }

    setPendingFile(file);
    if (file.type.startsWith("image/")) {
      const url = URL.createObjectURL(file);
      setFilePreview(url);
    } else {
      setFilePreview(null);
    }
  }

  function clearPendingFile() {
    if (filePreview) URL.revokeObjectURL(filePreview);
    setPendingFile(null);
    setFilePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // Delete a single message for everyone
  async function handleDeleteMessage(messageId: string) {
    setIsDeleting(true);
    try {
      if (socket?.connected) {
        await new Promise<void>((resolve, reject) => {
          socket.emit(
            "message:delete",
            { messageId: String(messageId) },
            (res: { ok: boolean; error?: string; message?: ChatMessage }) => {
              if (res.ok && res.message) {
                const updatedMsg = res.message;
                setMessages((prev) =>
                  prev.map((m) =>
                    String(m.id) === String(messageId)
                      ? {
                          ...m,
                          ...updatedMsg,
                          isDeleted: true,
                          type: "deleted",
                          body: "This message was deleted",
                          fileUrl: null,
                          fileName: null,
                          fileSize: null,
                          fileMime: null,
                        }
                      : m
                  )
                );
                resolve();
              } else {
                reject(new Error(res.error || "Failed to delete message"));
              }
            }
          );
        });
      } else {
        const res = await fetch(`${API_URL}/api/messages/${messageId}`, {
          method: "DELETE",
          credentials: "include",
        });
        if (!res.ok) throw new Error("Failed to delete message");
        const data = await res.json();
        setMessages((prev) =>
          prev.map((m) =>
            String(m.id) === String(messageId)
              ? {
                  ...m,
                  ...data.message,
                  isDeleted: true,
                  type: "deleted",
                  body: "This message was deleted",
                  fileUrl: null,
                  fileName: null,
                  fileSize: null,
                  fileMime: null,
                }
              : m
          )
        );
      }
      setMessageToDelete(null);
      pushToast("Message deleted for everyone", "info");
    } catch {
      pushToast("Could not delete message", "error");
    } finally {
      setIsDeleting(false);
    }
  }

  // Delete complete chat for both users
  async function handleClearChat() {
    setIsDeleting(true);
    try {
      let noticeMessage: ChatMessage | null = null;
      if (socket?.connected) {
        await new Promise<void>((resolve, reject) => {
          socket.emit(
            "chat:clear",
            { to: friend.id },
            (res: { ok: boolean; error?: string; message?: ChatMessage }) => {
              if (res.ok && res.message) {
                noticeMessage = res.message;
                resolve();
              } else {
                reject(new Error(res.error || "Failed to delete chat"));
              }
            }
          );
        });
      } else {
        const res = await fetch(`${API_URL}/api/messages/conversation/${friend.id}`, {
          method: "DELETE",
          credentials: "include",
        });
        if (!res.ok) throw new Error("Failed to delete chat");
        const data = await res.json();
        noticeMessage = data.message;
      }

      // Reset locks and session cache
      sessionStorage.removeItem(`chat_unlock_${friend.id}`);
      setLockStatus({ status: "none", isRequester: false, requesterName: null });
      setIsUnlocked(true);

      // Replace messages with the system tombstone notice
      setMessages(noticeMessage ? [noticeMessage] : []);
      setHasMore(false);
      setShowClearChatModal(false);
      pushToast("Complete chat deleted for both users", "info");
    } catch {
      pushToast("Could not delete chat", "error");
    } finally {
      setIsDeleting(false);
    }
  }

  // Unlock chat submission
  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    const pwd = unlockPassword.trim();
    if (!pwd) return;

    setUnlocking(true);
    setUnlockError("");
    try {
      await api<{ ok: boolean }>(`/api/chat-lock/${friend.id}/verify`, {
        method: "POST",
        body: { password: pwd },
      });
      sessionStorage.setItem(`chat_unlock_${friend.id}`, pwd);
      setIsUnlocked(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Incorrect password";
      setUnlockError(msg);
    } finally {
      setUnlocking(false);
    }
  }

  function emitTyping(isTyping: boolean) {
    if (!socket || typingSent.current === isTyping) return;
    typingSent.current = isTyping;
    socket.emit("typing", { to: friend.id, isTyping });
  }

  function onChange(value: string) {
    setText(value);
    if (value.trim()) {
      emitTyping(true);
      if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
      typingStopTimer.current = setTimeout(() => emitTyping(false), 2000);
    } else {
      emitTyping(false);
    }
  }

  function handleEmojiSelect(emoji: string) {
    const input = inputRef.current;
    if (!input) {
      setText((t) => t + emoji);
      return;
    }
    const start = input.selectionStart ?? text.length;
    const end = input.selectionEnd ?? text.length;
    const newText = text.substring(0, start) + emoji + text.substring(end);
    setText(newText);
    setTimeout(() => {
      input.focus();
      input.setSelectionRange(start + emoji.length, start + emoji.length);
    }, 10);
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!socket || !user) return;
    const cleanText = text.trim();
    if (!cleanText && !pendingFile) return;

    const tempId = `tmp-${++tempCounter.current}`;
    let fileMeta: {
      url: string;
      name: string;
      size: number;
      mime: string;
      type: "image" | "video" | "file";
    } | null = null;

    if (pendingFile) {
      setUploadingFile(true);
      try {
        const formData = new FormData();
        formData.append("file", pendingFile);
        const res = await fetch(`${API_URL}/api/upload/media`, {
          method: "POST",
          credentials: "include",
          body: formData,
        });
        if (!res.ok) throw new Error("Upload failed");
        fileMeta = await res.json();
      } catch {
        pushToast("Failed to upload file attachment", "error");
        setUploadingFile(false);
        return;
      }
      setUploadingFile(false);
    }

    const optimistic: ChatMessage = {
      id: tempId,
      senderId: user.id,
      receiverId: friend.id,
      body: cleanText,
      type: fileMeta ? fileMeta.type : "text",
      fileUrl: fileMeta ? fileMeta.url : null,
      fileName: fileMeta ? fileMeta.name : null,
      fileSize: fileMeta ? fileMeta.size : null,
      fileMime: fileMeta ? fileMeta.mime : null,
      createdAt: new Date().toISOString(),
      deliveredAt: null,
      readAt: null,
      pending: true,
    };

    stickToBottom.current = true;
    setMessages((prev) => dedupeAndSort([...prev, optimistic]));
    setText("");
    clearPendingFile();
    emitTyping(false);

    socket.emit(
      "message:send",
      {
        to: friend.id,
        body: cleanText,
        type: optimistic.type,
        fileUrl: optimistic.fileUrl,
        fileName: optimistic.fileName,
        fileSize: optimistic.fileSize,
        fileMime: optimistic.fileMime,
      },
      (res: SendAck) => {
        setMessages((prev) =>
          dedupeAndSort(
            res.ok
              ? prev.map((m) => (m.id === tempId ? res.message : m))
              : prev.map((m) => (m.id === tempId ? { ...m, pending: false, failed: true } : m))
          )
        );
        if (res.ok) onSent(res.message);
        else pushToast(res.error, "error");
      }
    );
  }

  const friendUser = {
    id: friend.id,
    username: friend.username,
    displayName: friend.displayName,
    avatarUrl: friend.avatarUrl,
    bio: friend.bio,
  };

  return (
    <section className="chat-window">
      {/* Header */}
      <header className="chat-header">
        <button className="icon-btn back-btn" onClick={onBack} aria-label="Back to conversations">
          <ArrowLeftIcon />
        </button>

        <Avatar
          id={friend.id}
          name={friend.displayName}
          avatarUrl={friend.avatarUrl}
          online={online}
          onClick={() => setShowUserProfile(true)}
        />

        <div
          className="row-main clickable"
          onClick={() => setShowUserProfile(true)}
          style={{ cursor: "pointer" }}
        >
          <strong className="truncate">{friend.displayName}</strong>
          <small className={`status-line ${peerTyping ? "is-typing" : online ? "is-online" : ""}`}>
            {peerTyping ? "typing..." : online ? "online" : "offline"}
          </small>
        </div>

        <div className="row-actions">
          {/* Chat lock status button */}
          <button
            className={`icon-btn icon-btn-bordered ${lockStatus.status === "active" ? "btn-accent-active" : ""}`}
            title={
              lockStatus.status === "active"
                ? "Chat is password protected"
                : lockStatus.status === "requested"
                ? "Protection request pending"
                : "Password protect this chat"
            }
            onClick={() => setShowLockModal(true)}
            aria-label="Chat lock settings"
          >
            {lockStatus.status === "active" ? (
              <LockIcon size={16} />
            ) : lockStatus.status === "requested" ? (
              <ShieldIcon size={16} />
            ) : (
              <UnlockIcon size={16} />
            )}
          </button>

          <button
            className="icon-btn icon-btn-bordered"
            title={online ? "Audio call" : "User is offline"}
            aria-label="Audio call"
            disabled={busy || !online}
            onClick={() => startCall(friendUser, "audio")}
          >
            <PhoneIcon />
          </button>

          <button
            className="icon-btn icon-btn-bordered"
            title={online ? "Video call" : "User is offline"}
            aria-label="Video call"
            disabled={busy || !online}
            onClick={() => startCall(friendUser, "video")}
          >
            <VideoIcon />
          </button>

          <button
            className="icon-btn icon-btn-bordered btn-danger-hover"
            title="Delete complete chat"
            aria-label="Delete complete chat"
            onClick={() => setShowClearChatModal(true)}
          >
            <TrashIcon size={16} />
          </button>
        </div>
      </header>

      {/* Banner for protection requests */}
      {lockStatus.status === "requested" && (
        <div className="chat-lock-banner">
          <ShieldIcon size={16} />
          {lockStatus.isRequester ? (
            <span>You requested chat password protection. Waiting for {friend.displayName} to confirm.</span>
          ) : (
            <div className="banner-content-with-action">
              <span>{friend.displayName} requested to password-protect this chat.</span>
              <button className="btn-primary btn-micro" onClick={() => setShowLockModal(true)}>
                Enter Password
              </button>
            </div>
          )}
        </div>
      )}

      {/* If Chat is Locked: show Password Protection Screen */}
      {lockStatus.status === "active" && !isUnlocked ? (
        <div className="chat-locked-screen">
          <div className="locked-card">
            <div className="locked-icon-circle">
              <LockIcon size={36} />
            </div>
            <h2>Password-Protected Chat</h2>
            <p>
              This conversation with <strong>{friend.displayName}</strong> is locked. Enter the agreed password to view messages.
            </p>

            <form onSubmit={handleUnlock} className="locked-form">
              <div className="form-group">
                <input
                  type="password"
                  placeholder="Enter chat password"
                  value={unlockPassword}
                  onChange={(e) => setUnlockPassword(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              {unlockError && <div className="unlock-error-msg">{unlockError}</div>}

              <button
                type="submit"
                className="btn-primary btn-block"
                disabled={unlocking || !unlockPassword.trim()}
              >
                {unlocking ? "Unlocking..." : "Unlock Chat"}
              </button>
            </form>
          </div>
        </div>
      ) : (
        <>
          {/* Messages list with scroll-up pagination */}
          <div
            className="messages"
            ref={scrollContainerRef}
            onScroll={handleScroll}
          >
            {loadingOlder && (
              <div className="loading-older" role="status" aria-label="Loading older messages">
                <div className="loading-older-pill">
                  <span className="spinner spinner-sm" />
                  <span>Loading older messages...</span>
                </div>
              </div>
            )}

            {!hasMore && !loading && messages.length > 0 && (
              <div className="history-start">
                <small>Beginning of conversation with {friend.displayName}</small>
              </div>
            )}

            {loading && (
              <p className="empty-small" role="status">
                Loading messages...
              </p>
            )}

            {!loading && messages.length === 0 && (
              <div className="empty-state">
                <span className="empty-icon">
                  <MessageIcon size={20} />
                </span>
                <strong>No messages yet</strong>
                <p>Send a message, emoji, photo, or file to {friend.displayName}.</p>
              </div>
            )}

            {messages.map((m, i) => {
              const mine = m.senderId === user?.id;
              const groupStart = i === 0 || messages[i - 1].senderId !== m.senderId;

              // Complete chat deletion system notice
              if (m.type === "chat_deleted") {
                return (
                  <div key={m.id} className="system-notice-row">
                    <div className="system-notice-badge danger-badge">
                      <TrashIcon size={14} />
                      <span>{m.body}</span>
                    </div>
                  </div>
                );
              }

              // Deleted single message placeholder
              if (m.type === "deleted" || m.isDeleted) {
                return (
                  <div
                    key={m.id}
                    className={`bubble-row ${mine ? "mine" : "theirs"} ${groupStart ? "group-start" : ""}`}
                  >
                    <div className="bubble bubble-deleted">
                      <span className="bubble-deleted-text">
                        <BanIcon size={14} />
                        <em>This message was deleted</em>
                      </span>
                      <span className="bubble-meta">{formatTime(m.createdAt)}</span>
                    </div>
                  </div>
                );
              }

              // Special rendering for call logs
              if (m.type === "call_log") {
                const isMissed = m.fileName === "missed";
                return (
                  <div key={m.id} className="call-log-row">
                    <div className={`call-log-card ${isMissed ? "call-log-missed" : ""}`}>
                      <span className="call-log-icon">
                        <PhoneIcon size={16} />
                      </span>
                      <div className="call-log-info">
                        <strong>{m.body}</strong>
                        <small>
                          {isMissed ? "Missed" : `Duration: ${formatDuration(m.duration || 0)}`} • {formatTime(m.createdAt)}
                        </small>
                      </div>
                      <button
                        className="btn-ghost btn-micro"
                        onClick={() => startCall(friendUser, "audio")}
                        disabled={busy || !online}
                        title="Call back"
                      >
                        Call back
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={m.id}
                  className={`bubble-row ${mine ? "mine" : "theirs"} ${groupStart ? "group-start" : ""}`}
                >
                  <div className={`bubble ${m.failed ? "bubble-failed" : ""}`}>
                    {/* Image Attachment */}
                    {m.type === "image" && m.fileUrl && (
                      <div className="bubble-media-wrap">
                        <img
                          src={formatMediaUrl(m.fileUrl)}
                          alt={m.fileName || "Image"}
                          className="bubble-img"
                          onClick={() => setLightboxSrc(m.fileUrl ?? null)}
                          onLoad={() => {
                            if (stickToBottom.current) scrollToBottom(true);
                          }}
                          loading="lazy"
                        />
                      </div>
                    )}

                    {/* Video Attachment */}
                    {m.type === "video" && m.fileUrl && (
                      <div className="bubble-media-wrap">
                        <video
                          src={formatMediaUrl(m.fileUrl)}
                          controls
                          className="bubble-video"
                          preload="metadata"
                        />
                      </div>
                    )}

                    {/* Generic File Attachment */}
                    {m.type === "file" && m.fileUrl && (
                      <div className="bubble-file-card">
                        <span className="file-icon-box">
                          <FileIcon size={24} />
                        </span>
                        <div className="file-card-details truncate">
                          <strong className="truncate">{m.fileName || "Attachment"}</strong>
                          <small>{formatFileSize(m.fileSize)}</small>
                        </div>
                        <a
                          href={formatMediaUrl(m.fileUrl)}
                          download={m.fileName || "file"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="file-download-link"
                          title="Download file"
                        >
                          <DownloadIcon size={16} />
                        </a>
                      </div>
                    )}

                    {/* Message text body / caption */}
                    {m.body && <span className="bubble-text">{m.body}</span>}

                    {/* Meta timestamp & ticks */}
                    <span className="bubble-meta">
                      {formatTime(m.createdAt)} {mine && <Ticks m={m} />}
                    </span>
                  </div>

                  {!m.pending && !m.failed && (
                    <button
                      type="button"
                      className="bubble-action-btn"
                      title="Delete message for everyone"
                      aria-label="Delete message"
                      onClick={() => setMessageToDelete(m.id)}
                    >
                      <TrashIcon size={13} />
                    </button>
                  )}
                </div>
              );
            })}

            {peerTyping && (
              <div className="bubble-row theirs group-start" aria-label={`${friend.displayName} is typing`}>
                <div className="bubble typing-bubble">
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Pending file attachment preview */}
          {pendingFile && (
            <div className="pending-file-bar">
              {filePreview ? (
                <img src={filePreview} alt="Preview" className="pending-thumb" />
              ) : (
                <div className="pending-file-icon">
                  <FileIcon size={20} />
                </div>
              )}
              <div className="pending-file-meta truncate">
                <strong className="truncate">{pendingFile.name}</strong>
                <small>{formatFileSize(pendingFile.size)}</small>
              </div>
              <button
                type="button"
                className="icon-btn-micro"
                onClick={clearPendingFile}
                title="Remove attachment"
              >
                <XIcon size={16} />
              </button>
            </div>
          )}

          {/* Emoji Picker Popover */}
          {showEmojiPicker && (
            <EmojiPicker
              onSelect={handleEmojiSelect}
              onClose={() => setShowEmojiPicker(false)}
            />
          )}

          {/* Composer */}
          <form className="composer" onSubmit={send}>
            <input
              ref={fileInputRef}
              type="file"
              style={{ display: "none" }}
              onChange={handleFileSelected}
            />

            <button
              type="button"
              className="icon-btn composer-icon-btn"
              onClick={() => fileInputRef.current?.click()}
              title="Attach image, video or file"
              disabled={uploadingFile}
            >
              <PaperclipIcon size={18} />
            </button>

            <button
              type="button"
              className={`icon-btn composer-icon-btn ${showEmojiPicker ? "btn-accent-active" : ""}`}
              onClick={() => setShowEmojiPicker((p) => !p)}
              title="Insert emoji"
            >
              <SmileIcon size={18} />
            </button>

            <input
              ref={inputRef}
              value={text}
              onChange={(e) => onChange(e.target.value)}
              placeholder={pendingFile ? "Add a caption..." : `Message ${friend.displayName}`}
              aria-label="Message"
              maxLength={4000}
              autoComplete="off"
              disabled={uploadingFile}
            />

            <button
              className="btn-primary btn-send"
              type="submit"
              disabled={(!text.trim() && !pendingFile) || uploadingFile}
              aria-label="Send message"
              title="Send"
            >
              {uploadingFile ? (
                <span className="spinner" />
              ) : (
                <span className="btn-send-label">Send</span>
              )}
            </button>
          </form>
        </>
      )}

      {/* Modals */}
      {showUserProfile && (
        <UserProfileModal
          user={friendUser}
          onClose={() => setShowUserProfile(false)}
        />
      )}

      {lightboxSrc && (
        <ImageLightbox
          src={lightboxSrc}
          onClose={() => setLightboxSrc(null)}
        />
      )}

      {showLockModal && (
        <ChatLockModal
          friend={friend}
          lockStatus={lockStatus}
          onClose={() => setShowLockModal(false)}
          onStatusChanged={(newStatus) => {
            setLockStatus(newStatus);
            if (newStatus.status !== "active") setIsUnlocked(true);
          }}
          onLockedImmediately={() => {
            sessionStorage.removeItem(`chat_unlock_${friend.id}`);
            setIsUnlocked(false);
          }}
        />
      )}

      {/* Delete Single Message Confirmation Modal */}
      {messageToDelete && (
        <div className="modal-backdrop" onClick={() => !isDeleting && setMessageToDelete(null)}>
          <div className="modal-card modal-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon-wrap text-danger">
              <TrashIcon size={26} />
            </div>
            <h3>Delete message?</h3>
            <p className="confirm-text">
              This message will be permanently deleted for everyone in this conversation.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setMessageToDelete(null)}
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={() => handleDeleteMessage(messageToDelete)}
                disabled={isDeleting}
              >
                {isDeleting ? "Deleting..." : "Delete for everyone"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Complete Chat Confirmation Modal */}
      {showClearChatModal && (
        <div className="modal-backdrop" onClick={() => !isDeleting && setShowClearChatModal(false)}>
          <div className="modal-card modal-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon-wrap text-danger">
              <TrashIcon size={28} />
            </div>
            <h3>Delete Complete Chat?</h3>
            <p className="confirm-text">
              Are you sure you want to delete the complete conversation with <strong>{friend.displayName}</strong>?
            </p>
            <div className="confirm-warning-box">
              <p>This will permanently purge:</p>
              <ul>
                <li>All message history & sent files (images, videos, attachments)</li>
                <li>All call logs & recorded durations</li>
                <li>Chat password locks and security settings</li>
              </ul>
              <strong>This will delete the entire chat for BOTH users and cannot be undone.</strong>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setShowClearChatModal(false)}
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={handleClearChat}
                disabled={isDeleting}
              >
                {isDeleting ? "Deleting..." : "Delete for Everyone"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
