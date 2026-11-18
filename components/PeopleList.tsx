"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { DirectoryUser } from "@/lib/types";
import Avatar from "./Avatar";
import { SearchIcon } from "./Icons";
import { useRealtime } from "./RealtimeProvider";
import UserProfileModal from "./UserProfileModal";

const PAGE_SIZE = 30;

interface UsersResponse {
  users: DirectoryUser[];
  hasMore: boolean;
}

export default function PeopleList({ onOpenChat }: { onOpenChat: (userId: string) => void }) {
  const { onlineIds, friendsVersion, pushToast } = useRealtime();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [inspectUser, setInspectUser] = useState<DirectoryUser | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  // (Re)load the first page when the search changes or friendships change in real time.
  useEffect(() => {
    let cancelled = false;
    api<UsersResponse>(`/api/users?q=${encodeURIComponent(debounced)}&limit=${PAGE_SIZE}`)
      .then((d) => {
        if (cancelled) return;
        setUsers(d.users);
        setHasMore(d.hasMore);
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [debounced, friendsVersion]);

  const loadMore = useCallback(async () => {
    try {
      const d = await api<UsersResponse>(
        `/api/users?q=${encodeURIComponent(debounced)}&limit=${PAGE_SIZE}&offset=${users.length}`
      );
      setUsers((prev) => [...prev, ...d.users]);
      setHasMore(d.hasMore);
    } catch {
      pushToast("Could not load more users", "error");
    }
  }, [debounced, users.length, pushToast]);

  async function sendRequest(userId: string) {
    setBusyId(userId);
    try {
      await api("/api/friends/requests", { method: "POST", body: { userId } });
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Could not send request", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function acceptIncoming(u: DirectoryUser) {
    if (!u.friendshipId) return;
    setBusyId(u.id);
    try {
      await api(`/api/friends/requests/${u.friendshipId}/accept`, { method: "POST" });
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Could not accept request", "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="panel-scroll">
      <div className="search-box">
        <SearchIcon size={16} className="search-icon" />
        <input
          type="search"
          placeholder="Search by name or username"
          aria-label="Search people"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loading && <p className="empty-small">Loading...</p>}
      {!loading && users.length === 0 && (
        <p className="empty-small">{debounced ? "No users found" : "No other users yet"}</p>
      )}

      {users.map((u) => (
        <div className="list-row" key={u.id}>
          <div onClick={() => setInspectUser(u)} style={{ cursor: "pointer" }} title={`View ${u.displayName}'s profile`}>
            <Avatar
              id={u.id}
              name={u.displayName}
              avatarUrl={u.avatarUrl}
              online={onlineIds.has(u.id)}
            />
          </div>
          <div className="row-main clickable" onClick={() => setInspectUser(u)} style={{ cursor: "pointer" }}>
            <strong className="truncate">{u.displayName}</strong>
            <small className="truncate">
              @{u.username} · {onlineIds.has(u.id) ? "online" : "offline"}
            </small>
          </div>
          <div className="row-actions">
            {u.relationship === "none" && (
              <button
                className="btn-small btn-primary"
                disabled={busyId === u.id}
                onClick={() => sendRequest(u.id)}
              >
                Add
              </button>
            )}
            {u.relationship === "outgoing" && <span className="pill">Requested</span>}
            {u.relationship === "incoming" && (
              <button
                className="btn-small btn-success"
                disabled={busyId === u.id}
                onClick={() => acceptIncoming(u)}
              >
                Accept
              </button>
            )}
            {u.relationship === "friend" && (
              <button className="btn-small btn-ghost" onClick={() => onOpenChat(u.id)}>
                Message
              </button>
            )}
          </div>
        </div>
      ))}

      {hasMore && (
        <button className="link-btn center" onClick={loadMore}>
          Load more
        </button>
      )}

      {inspectUser && (
        <UserProfileModal
          user={inspectUser}
          onClose={() => setInspectUser(null)}
          onOpenChat={onOpenChat}
        />
      )}
    </div>
  );
}
