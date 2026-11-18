"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Socket } from "socket.io-client";
import { api } from "@/lib/api";
import { notificationText } from "@/lib/format";
import { createSocket } from "@/lib/socket";
import type { AppNotification } from "@/lib/types";
import { useAuth } from "./AuthProvider";
import Toasts, { type Toast } from "./Toasts";

interface RealtimeContextValue {
  socket: Socket | null;
  connected: boolean;
  onlineIds: Set<string>;
  notifications: AppNotification[];
  unreadNotifications: number;
  markNotificationsRead: () => Promise<void>;
  /** Incremented whenever friends/requests change (via socket) so lists can refetch. */
  friendsVersion: number;
  pushToast: (text: string, kind?: Toast["kind"]) => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export default function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id;

  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [friendsVersion, setFriendsVersion] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback(
    (text: string, kind: Toast["kind"] = "info") => {
      const id = ++toastId.current;
      setToasts((prev) => [...prev.slice(-3), { id, text, kind }]);
      setTimeout(() => dismissToast(id), 5000);
    },
    [dismissToast]
  );

  useEffect(() => {
    if (!userId) return;

    const s = createSocket();
    setSocket(s);

    s.on("connect", () => setConnected(true));
    s.on("disconnect", () => setConnected(false));

    s.on("presence:init", ({ onlineIds: ids }: { onlineIds: string[] }) => {
      setOnlineIds(new Set(ids));
    });
    s.on("presence:update", ({ userId: id, online }: { userId: string; online: boolean }) => {
      setOnlineIds((prev) => {
        const next = new Set(prev);
        if (online) next.add(id);
        else next.delete(id);
        return next;
      });
    });

    s.on("friend:update", () => setFriendsVersion((v) => v + 1));

    s.on("notification:new", (n: AppNotification) => {
      setNotifications((prev) => [n, ...prev.filter((p) => p.id !== n.id)]);
      const text = notificationText(n);
      pushToast(text, n.type === "missed_call" ? "warning" : "info");
      if (
        typeof document !== "undefined" &&
        document.hidden &&
        "Notification" in window &&
        Notification.permission === "granted"
      ) {
        new Notification("Chat", { body: text });
      }
    });

    api<{ notifications: AppNotification[] }>("/api/notifications")
      .then((d) => setNotifications(d.notifications))
      .catch(() => undefined);

    return () => {
      s.removeAllListeners();
      s.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [userId, pushToast]);

  const markNotificationsRead = useCallback(async () => {
    const hasUnread = notifications.some((n) => !n.readAt);
    if (!hasUnread) return;
    const nowIso = new Date().toISOString();
    setNotifications((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: nowIso })));
    await api("/api/notifications/read", { method: "POST", body: {} }).catch(() => undefined);
  }, [notifications]);

  const unreadNotifications = useMemo(
    () => notifications.filter((n) => !n.readAt).length,
    [notifications]
  );

  const value = useMemo<RealtimeContextValue>(
    () => ({
      socket,
      connected,
      onlineIds,
      notifications,
      unreadNotifications,
      markNotificationsRead,
      friendsVersion,
      pushToast,
    }),
    [
      socket,
      connected,
      onlineIds,
      notifications,
      unreadNotifications,
      markNotificationsRead,
      friendsVersion,
      pushToast,
    ]
  );

  return (
    <RealtimeContext.Provider value={value}>
      {children}
      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </RealtimeContext.Provider>
  );
}

export function useRealtime(): RealtimeContextValue {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error("useRealtime must be used inside <RealtimeProvider>");
  return ctx;
}
