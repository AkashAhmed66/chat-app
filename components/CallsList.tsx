"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatDateOrTime, formatDuration } from "@/lib/format";
import type { CallRecord } from "@/lib/types";
import Avatar from "./Avatar";
import { useCall } from "./CallProvider";
import {
  CallIncomingIcon,
  CallMissedIcon,
  CallOutgoingIcon,
  PhoneIcon,
  PhoneOffIcon,
  VideoIcon,
} from "./Icons";
import { useRealtime } from "./RealtimeProvider";

export default function CallsList({ onOpenChat }: { onOpenChat: (userId: string) => void }) {
  const { onlineIds, socket } = useRealtime();
  const { busy, startCall } = useCall();
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const loadCalls = useCallback(async () => {
    try {
      const d = await api<{ calls: CallRecord[] }>("/api/calls?limit=40");
      setCalls(d.calls);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCalls();
  }, [loadCalls]);

  // Refresh when call ends
  useEffect(() => {
    if (!socket) return;
    const onCallEnded = () => {
      // Short delay to let the backend persist duration
      setTimeout(() => void loadCalls(), 600);
    };
    socket.on("call:ended", onCallEnded);
    socket.on("call:missed", onCallEnded);
    socket.on("call:rejected", onCallEnded);
    socket.on("chat:cleared", loadCalls);
    return () => {
      socket.off("call:ended", onCallEnded);
      socket.off("call:missed", onCallEnded);
      socket.off("call:rejected", onCallEnded);
      socket.off("chat:cleared", loadCalls);
    };
  }, [socket, loadCalls]);

  return (
    <div className="panel-scroll">
      {loading && (
        <p className="empty-small" role="status">
          Loading call history...
        </p>
      )}

      {!loading && calls.length === 0 && (
        <div className="empty-state">
          <span className="empty-icon">
            <PhoneIcon size={20} />
          </span>
          <strong>No calls yet</strong>
          <p>Start an audio or video call with any friend from the chat window.</p>
        </div>
      )}

      {calls.map((c) => {
        const isOnline = onlineIds.has(c.peer.id);
        const isMissed = c.status === "missed";
        const isRejected = c.status === "rejected";
        const isCancelled = c.status === "cancelled";
        const isAnswered = c.status === "ended" || c.status === "accepted";

        let statusText = "Ended";
        if (isMissed) statusText = "Missed";
        else if (isRejected) statusText = "Declined";
        else if (isCancelled) statusText = "Cancelled";
        else if (isAnswered) statusText = formatDuration(c.duration);

        return (
          <div key={c.id} className="list-row call-row">
            <div
              className="avatar-link"
              onClick={() => onOpenChat(c.peer.id)}
              style={{ cursor: "pointer" }}
            >
              <Avatar
                id={c.peer.id}
                name={c.peer.displayName}
                avatarUrl={c.peer.avatarUrl}
                online={isOnline}
              />
            </div>

            <div
              className="row-main clickable"
              onClick={() => onOpenChat(c.peer.id)}
              style={{ cursor: "pointer" }}
            >
              <div className="row-line">
                <strong className="truncate">{c.peer.displayName}</strong>
                <small className="row-time">{formatDateOrTime(c.createdAt)}</small>
              </div>

              <div className="row-line call-meta-line">
                <span className={`call-direction-badge ${isMissed ? "is-missed" : ""}`}>
                  {isMissed ? (
                    <CallMissedIcon size={14} />
                  ) : c.isCaller ? (
                    <CallOutgoingIcon size={14} />
                  ) : (
                    <CallIncomingIcon size={14} />
                  )}
                  <span className="call-type-name">
                    {c.type === "video" ? "Video" : "Audio"} • {statusText}
                  </span>
                </span>
              </div>
            </div>

            <div className="row-actions">
              <button
                className="icon-btn icon-btn-bordered"
                title={isOnline ? `Call back (${c.type})` : "User is offline"}
                disabled={busy || !isOnline}
                onClick={() => startCall(c.peer, c.type)}
                aria-label={`Call back ${c.peer.displayName}`}
              >
                {c.type === "video" ? <VideoIcon size={16} /> : <PhoneIcon size={16} />}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
