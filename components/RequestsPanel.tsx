"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { FriendRequest } from "@/lib/types";
import Avatar from "./Avatar";
import { useRealtime } from "./RealtimeProvider";

export default function RequestsPanel({
  incoming,
  outgoing,
  onChanged,
}: {
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  onChanged: () => void;
}) {
  const { onlineIds, pushToast } = useRealtime();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    try {
      await fn();
      onChanged();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Action failed", "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="panel-scroll">
      <h3 className="section-title">
        Received <span className="count">{incoming.length}</span>
      </h3>
      {incoming.length === 0 && <p className="empty-small">No pending requests</p>}
      {incoming.map((r) => (
        <div className="list-row" key={r.id}>
          <Avatar id={r.user.id} name={r.user.displayName} avatarUrl={r.user.avatarUrl} online={onlineIds.has(r.user.id)} />
          <div className="row-main">
            <strong className="truncate">{r.user.displayName}</strong>
            <small className="truncate">@{r.user.username}</small>
          </div>
          <div className="row-actions">
            <button
              className="btn-small btn-success"
              disabled={busyId === r.id}
              onClick={() =>
                run(r.id, () => api(`/api/friends/requests/${r.id}/accept`, { method: "POST" }))
              }
            >
              Accept
            </button>
            <button
              className="btn-small btn-ghost"
              disabled={busyId === r.id}
              onClick={() => run(r.id, () => api(`/api/friends/requests/${r.id}`, { method: "DELETE" }))}
            >
              Decline
            </button>
          </div>
        </div>
      ))}

      <h3 className="section-title">
        Sent <span className="count">{outgoing.length}</span>
      </h3>
      {outgoing.length === 0 && <p className="empty-small">No outgoing requests</p>}
      {outgoing.map((r) => (
        <div className="list-row" key={r.id}>
          <Avatar id={r.user.id} name={r.user.displayName} avatarUrl={r.user.avatarUrl} online={onlineIds.has(r.user.id)} />
          <div className="row-main">
            <strong className="truncate">{r.user.displayName}</strong>
            <small className="truncate">@{r.user.username}</small>
          </div>
          <div className="row-actions">
            <button
              className="btn-small btn-ghost"
              disabled={busyId === r.id}
              onClick={() => run(r.id, () => api(`/api/friends/requests/${r.id}`, { method: "DELETE" }))}
            >
              Cancel
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
