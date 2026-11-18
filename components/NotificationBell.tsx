"use client";

import { useState } from "react";
import { notificationText, timeAgo } from "@/lib/format";
import { BellIcon } from "./Icons";
import { useRealtime } from "./RealtimeProvider";

export default function NotificationBell() {
  const { notifications, unreadNotifications, markNotificationsRead } = useRealtime();
  const [open, setOpen] = useState(false);
  const [nowMs, setNowMs] = useState(0);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(() =>
    typeof window !== "undefined" && "Notification" in window
      ? Notification.permission
      : "unsupported"
  );

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      setNowMs(Date.now());
      void markNotificationsRead();
    }
  }

  async function enableDesktop() {
    if (!("Notification" in window)) return;
    setPermission(await Notification.requestPermission());
  }

  return (
    <div className="bell">
      <button className="icon-btn" onClick={toggle} aria-label="Notifications" title="Notifications">
        <BellIcon />
        {unreadNotifications > 0 && <span className="badge">{unreadNotifications}</span>}
      </button>

      {open && (
        <>
          <div className="popover-backdrop" onClick={() => setOpen(false)} />
          <div className="popover" role="dialog" aria-label="Notifications">
            <div className="popover-title">Notifications</div>
            {permission === "default" && (
              <button className="link-btn popover-action" onClick={enableDesktop}>
                Enable desktop notifications
              </button>
            )}
            {notifications.length === 0 ? (
              <p className="empty-small">You're all caught up</p>
            ) : (
              <ul className="notification-list">
                {notifications.map((n) => (
                  <li key={n.id} className={n.readAt ? "" : "unread"}>
                    <span>{notificationText(n)}</span>
                    <small>{timeAgo(n.createdAt, nowMs)}</small>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
