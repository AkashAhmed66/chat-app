"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { formatTime } from "@/lib/format";
import type { ChatMessage, Friend, FriendRequest, User } from "@/lib/types";
import { useAuth } from "./AuthProvider";
import Avatar from "./Avatar";
import CallsList from "./CallsList";
import ChatWindow from "./ChatWindow";
import { EditIcon, InboxIcon, LogOutIcon, MessageIcon, PhoneIcon, UsersIcon } from "./Icons";
import NotificationBell from "./NotificationBell";
import PeopleList from "./PeopleList";
import ProfileModal from "./ProfileModal";
import { useRealtime } from "./RealtimeProvider";
import RequestsPanel from "./RequestsPanel";
import ThemeToggle from "./ThemeToggle";
import UserProfileModal from "./UserProfileModal";

type Tab = "chats" | "people" | "calls" | "requests";

export default function ChatApp() {
  const { user, logout } = useAuth();
  const { socket, connected, onlineIds, friendsVersion, pushToast } = useRealtime();

  const [tab, setTab] = useState<Tab>("chats");
  const [friends, setFriends] = useState<Friend[]>([]);
  const [incoming, setIncoming] = useState<FriendRequest[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Profile modals
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [inspectUser, setInspectUser] = useState<User | null>(null);

  const activeIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  const friendsRef = useRef<Friend[]>([]);
  useEffect(() => {
    friendsRef.current = friends;
  }, [friends]);

  /** Update a conversation's last message / unread badge and move it to the top. */
  const bumpConversation = useCallback((m: ChatMessage, otherId: string, incomingMsg: boolean) => {
    let previewText = m.body;
    if (!previewText) {
      if (m.type === "image") previewText = "📷 Image";
      else if (m.type === "video") previewText = "🎥 Video";
      else if (m.type === "file") previewText = `📎 ${m.fileName || "File"}`;
      else if (m.type === "call_log") previewText = "📞 Call";
    }

    setFriends((prev) =>
      prev
        .map((f) => {
          if (f.id !== otherId) return f;
          const isOpen = activeIdRef.current === otherId && !document.hidden;
          return {
            ...f,
            lastMessage: {
              body: previewText,
              type: m.type,
              fileName: m.fileName,
              at: m.createdAt,
              senderId: m.senderId,
            },
            unread: incomingMsg && !isOpen ? f.unread + 1 : f.unread,
          };
        })
        .sort((a, b) => (b.lastMessage?.at ?? "").localeCompare(a.lastMessage?.at ?? ""))
    );
  }, []);

  const loadFriends = useCallback(async () => {
    try {
      const d = await api<{ friends: Friend[] }>("/api/friends");
      setFriends(d.friends.map((f) => (f.id === activeIdRef.current ? { ...f, unread: 0 } : f)));
    } catch {
      /* keep stale list */
    }
  }, []);

  const loadRequests = useCallback(async () => {
    try {
      const d = await api<{ incoming: FriendRequest[]; outgoing: FriendRequest[] }>(
        "/api/friends/requests"
      );
      setIncoming(d.incoming);
      setOutgoing(d.outgoing);
    } catch {
      /* keep stale list */
    }
  }, []);

  useEffect(() => {
    void loadFriends();
    void loadRequests();
  }, [friendsVersion, loadFriends, loadRequests]);

  // Keep the conversation list live
  useEffect(() => {
    if (!socket) return;

    const onNew = (m: ChatMessage) => {
      const isOpen = activeIdRef.current === m.senderId && !document.hidden;
      bumpConversation(m, m.senderId, true);
      if (!isOpen) {
        const sender = friendsRef.current.find((f) => f.id === m.senderId);
        const snippet =
          m.body || (m.type === "image" ? "sent an image" : m.type === "video" ? "sent a video" : "sent a file");
        pushToast(`${sender?.displayName ?? "New message"}: ${snippet.slice(0, 80)}`, "info");
        if (document.hidden && "Notification" in window && Notification.permission === "granted") {
          new Notification(sender?.displayName ?? "New message", { body: snippet.slice(0, 120) });
        }
      }
    };

    const onSelf = (m: ChatMessage) => bumpConversation(m, m.receiverId, false);
    const onConversationRead = ({ userId }: { userId: string }) => {
      setFriends((prev) => prev.map((f) => (f.id === userId ? { ...f, unread: 0 } : f)));
    };

    const onReconnect = () => {
      void loadFriends();
      void loadRequests();
    };

    const onChatCleared = () => {
      void loadFriends();
    };

    const onMessageDeleted = () => {
      void loadFriends();
    };

    socket.on("message:new", onNew);
    socket.on("message:self", onSelf);
    socket.on("conversation:read", onConversationRead);
    socket.on("chat:cleared", onChatCleared);
    socket.on("message:deleted", onMessageDeleted);
    socket.io.on("reconnect", onReconnect);
    return () => {
      socket.off("message:new", onNew);
      socket.off("message:self", onSelf);
      socket.off("conversation:read", onConversationRead);
      socket.off("chat:cleared", onChatCleared);
      socket.off("message:deleted", onMessageDeleted);
      socket.io.off("reconnect", onReconnect);
    };
  }, [socket, pushToast, bumpConversation, loadFriends, loadRequests]);

  function openChat(userId: string) {
    setActiveId(userId);
    setTab("chats");
    setFriends((prev) => prev.map((f) => (f.id === userId ? { ...f, unread: 0 } : f)));
  }

  const activeFriend = friends.find((f) => f.id === activeId) ?? null;
  const totalUnread = friends.reduce((sum, f) => sum + f.unread, 0);

  if (!user) return null;

  return (
    <div className={`app-shell ${activeFriend ? "has-active" : ""}`}>
      <aside className="sidebar">
        {/* Sidebar Header */}
        <header className="sidebar-header">
          <Avatar
            id={user.id}
            name={user.displayName}
            avatarUrl={user.avatarUrl}
            online={connected}
            onClick={() => setShowProfileModal(true)}
          />
          <div
            className="row-main clickable"
            onClick={() => setShowProfileModal(true)}
            style={{ cursor: "pointer" }}
            title="Edit profile"
          >
            <strong className="truncate">{user.displayName}</strong>
            <small className={`status-line ${connected ? "" : "is-warning"}`}>
              {connected ? "Connected" : "Reconnecting..."}
            </small>
          </div>
          <button
            className="icon-btn"
            onClick={() => setShowProfileModal(true)}
            title="Edit profile"
            aria-label="Edit profile"
          >
            <EditIcon size={16} />
          </button>
          <ThemeToggle />
          <NotificationBell />
          <button className="icon-btn" onClick={() => void logout()} title="Sign out" aria-label="Sign out">
            <LogOutIcon />
          </button>
        </header>

        {/* Sidebar Tabs */}
        <nav className="tabs" role="tablist" aria-label="Sidebar sections">
          <button
            role="tab"
            aria-selected={tab === "chats"}
            className={tab === "chats" ? "active" : ""}
            onClick={() => setTab("chats")}
          >
            <MessageIcon size={16} />
            Chats{totalUnread > 0 && <span className="badge inline">{totalUnread}</span>}
          </button>
          <button
            role="tab"
            aria-selected={tab === "people"}
            className={tab === "people" ? "active" : ""}
            onClick={() => setTab("people")}
          >
            <UsersIcon size={16} />
            People
          </button>
          <button
            role="tab"
            aria-selected={tab === "calls"}
            className={tab === "calls" ? "active" : ""}
            onClick={() => setTab("calls")}
          >
            <PhoneIcon size={16} />
            Calls
          </button>
          <button
            role="tab"
            aria-selected={tab === "requests"}
            className={tab === "requests" ? "active" : ""}
            onClick={() => setTab("requests")}
          >
            <InboxIcon size={16} />
            Requests
            {incoming.length > 0 && <span className="badge inline">{incoming.length}</span>}
          </button>
        </nav>

        {/* Tab 1: Chats */}
        {tab === "chats" && (
          <div className="panel-scroll">
            {friends.length === 0 && (
              <div className="empty-state">
                <span className="empty-icon">
                  <MessageIcon size={20} />
                </span>
                <strong>No conversations yet</strong>
                <p>
                  Open <b>People</b> to find someone and send a request.
                </p>
                <button className="btn-ghost btn-small" onClick={() => setTab("people")}>
                  Find people
                </button>
              </div>
            )}
            {friends.map((f) => (
              <div
                key={f.id}
                className={`list-row clickable ${f.id === activeId ? "selected" : ""}`}
                onClick={() => openChat(f.id)}
                aria-current={f.id === activeId ? "true" : undefined}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openChat(f.id);
                  }
                }}
              >
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    setInspectUser(f);
                  }}
                  title={`View ${f.displayName}'s profile`}
                >
                  <Avatar
                    id={f.id}
                    name={f.displayName}
                    avatarUrl={f.avatarUrl}
                    online={onlineIds.has(f.id)}
                  />
                </div>
                <div className="row-main">
                  <div className="row-line">
                    <strong className="truncate">{f.displayName}</strong>
                    {f.lastMessage && <small className="row-time">{formatTime(f.lastMessage.at)}</small>}
                  </div>
                  <div className="row-line">
                    <small className="preview">
                      {f.lastMessage
                        ? `${f.lastMessage.senderId === user.id ? "You: " : ""}${f.lastMessage.body}`
                        : "No messages yet"}
                    </small>
                    {f.unread > 0 && <span className="badge inline">{f.unread}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tab 2: People */}
        {tab === "people" && <PeopleList onOpenChat={openChat} />}

        {/* Tab 3: Calls */}
        {tab === "calls" && <CallsList onOpenChat={openChat} />}

        {/* Tab 4: Requests */}
        {tab === "requests" && (
          <RequestsPanel
            incoming={incoming}
            outgoing={outgoing}
            onChanged={() => {
              void loadRequests();
              void loadFriends();
            }}
          />
        )}
      </aside>

      {/* Main Chat Area */}
      <main className="main-pane">
        {activeFriend ? (
          <ChatWindow
            key={activeFriend.id}
            friend={activeFriend}
            onBack={() => setActiveId(null)}
            onSent={(m) => bumpConversation(m, m.receiverId, false)}
          />
        ) : (
          <div className="empty-main">
            <span className="empty-icon empty-icon-lg">
              <MessageIcon size={26} />
            </span>
            <h2>Select a conversation</h2>
            <p>Pick a friend to start messaging, or find people in the People tab.</p>
          </div>
        )}
      </main>

      {/* Profile Modals */}
      {showProfileModal && <ProfileModal onClose={() => setShowProfileModal(false)} />}
      {inspectUser && (
        <UserProfileModal
          user={inspectUser}
          onClose={() => setInspectUser(null)}
          onOpenChat={openChat}
        />
      )}
    </div>
  );
}
