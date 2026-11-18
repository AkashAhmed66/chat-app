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
import type { Ack, CallType, User } from "@/lib/types";
import ActiveCall from "./ActiveCall";
import Avatar from "./Avatar";
import { PhoneIcon, PhoneOffIcon, VideoIcon } from "./Icons";
import { useRealtime } from "./RealtimeProvider";

type CallState =
  | { phase: "idle" }
  | { phase: "outgoing"; callId: string; peer: User; type: CallType; ringing: boolean }
  | { phase: "incoming"; callId: string; peer: User; type: CallType }
  | {
      phase: "active";
      callId: string;
      peer: User;
      type: CallType;
      mode: CallType;
      token: string;
      serverUrl: string;
    };

interface CallContextValue {
  busy: boolean;
  startCall: (peer: User, type: CallType) => void;
}

const CallContext = createContext<CallContextValue | null>(null);

type StartAck = Ack<{ callId: string }>;
type AcceptAck = Ack<{ token: string; serverUrl: string; mode: CallType; type: CallType }>;

/** Plays a simple repeating ring using WebAudio (best effort; browsers may block autoplay). */
function useRingtone(active: boolean) {
  useEffect(() => {
    if (!active) return;
    let ctx: AudioContext | null = null;
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
    } catch {
      return;
    }
    const audio = ctx;
    const beep = () => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = 440;
      gain.gain.value = 0.08;
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start();
      osc.stop(audio.currentTime + 0.6);
    };
    void audio.resume().catch(() => undefined);
    beep();
    const timer = setInterval(beep, 2000);
    return () => {
      clearInterval(timer);
      void audio.close().catch(() => undefined);
    };
  }, [active]);
}

export default function CallProvider({ children }: { children: React.ReactNode }) {
  const { socket, pushToast } = useRealtime();
  const [call, setCall] = useState<CallState>({ phase: "idle" });

  // Socket handlers need the latest call state without re-subscribing on every change.
  const callRef = useRef<CallState>(call);
  useEffect(() => {
    callRef.current = call;
  }, [call]);

  useRingtone(call.phase === "incoming");

  useEffect(() => {
    if (!socket) return;

    const onIncoming = (p: { callId: string; type: CallType; from: User }) => {
      if (callRef.current.phase !== "idle") return;
      setCall({ phase: "incoming", callId: p.callId, peer: p.from, type: p.type });
      // Delivery receipt: lets the caller see "Ringing" instead of "Calling".
      socket.emit("call:delivered", { callId: p.callId });
      if (
        document.hidden &&
        "Notification" in window &&
        Notification.permission === "granted"
      ) {
        new Notification(`Incoming ${p.type} call`, { body: p.from.displayName });
      }
    };

    const onRinging = ({ callId }: { callId: string }) => {
      setCall((prev) =>
        prev.phase === "outgoing" && prev.callId === callId ? { ...prev, ringing: true } : prev
      );
    };

    const onAccepted = (p: { callId: string; token: string; serverUrl: string }) => {
      setCall((prev) =>
        prev.phase === "outgoing" && prev.callId === p.callId
          ? {
              phase: "active",
              callId: p.callId,
              peer: prev.peer,
              type: prev.type,
              mode: prev.type,
              token: p.token,
              serverUrl: p.serverUrl,
            }
          : prev
      );
    };

    const finish =
      (phases: CallState["phase"][], message?: (peer: User) => string) =>
      ({ callId }: { callId: string }) => {
        const cur = callRef.current;
        if (cur.phase === "idle" || cur.callId !== callId || !phases.includes(cur.phase)) return;
        if (message) pushToast(message(cur.peer), "info");
        setCall({ phase: "idle" });
      };

    const onRejected = finish(["outgoing"], (p) => `${p.displayName} declined the call`);
    const onMissed = finish(["outgoing"], (p) => `${p.displayName} didn't answer`);
    const onCancelled = finish(["incoming"]);
    const onHandled = finish(["incoming"]);
    const onEnded = finish(["active", "outgoing"], () => "Call ended");

    socket.on("call:incoming", onIncoming);
    socket.on("call:ringing", onRinging);
    socket.on("call:accepted", onAccepted);
    socket.on("call:rejected", onRejected);
    socket.on("call:missed", onMissed);
    socket.on("call:cancelled", onCancelled);
    socket.on("call:handled", onHandled);
    socket.on("call:ended", onEnded);
    return () => {
      socket.off("call:incoming", onIncoming);
      socket.off("call:ringing", onRinging);
      socket.off("call:accepted", onAccepted);
      socket.off("call:rejected", onRejected);
      socket.off("call:missed", onMissed);
      socket.off("call:cancelled", onCancelled);
      socket.off("call:handled", onHandled);
      socket.off("call:ended", onEnded);
    };
  }, [socket, pushToast]);

  // If the socket drops mid-ringing, the server will clean up; reset the UI.
  useEffect(() => {
    if (!socket) return;
    const onDisconnect = () => {
      const cur = callRef.current;
      if (cur.phase === "outgoing" || cur.phase === "incoming") setCall({ phase: "idle" });
    };
    socket.on("disconnect", onDisconnect);
    return () => {
      socket.off("disconnect", onDisconnect);
    };
  }, [socket]);

  const startCall = useCallback(
    (peer: User, type: CallType) => {
      if (!socket || callRef.current.phase !== "idle") return;
      socket.emit("call:start", { to: peer.id, type }, (res: StartAck) => {
        if (!res.ok) {
          pushToast(res.error, "warning");
          return;
        }
        setCall({ phase: "outgoing", callId: res.callId, peer, type, ringing: false });
      });
    },
    [socket, pushToast]
  );

  const cancelOutgoing = useCallback(() => {
    const cur = callRef.current;
    if (cur.phase !== "outgoing") return;
    socket?.emit("call:cancel", { callId: cur.callId });
    setCall({ phase: "idle" });
  }, [socket]);

  const rejectIncoming = useCallback(() => {
    const cur = callRef.current;
    if (cur.phase !== "incoming") return;
    socket?.emit("call:reject", { callId: cur.callId });
    setCall({ phase: "idle" });
  }, [socket]);

  const acceptIncoming = useCallback(
    (mode: CallType) => {
      const cur = callRef.current;
      if (cur.phase !== "incoming" || !socket) return;
      const { callId, peer } = cur;
      socket.emit("call:accept", { callId, mode }, (res: AcceptAck) => {
        if (!res.ok) {
          pushToast(res.error, "warning");
          setCall({ phase: "idle" });
          return;
        }
        setCall({
          phase: "active",
          callId,
          peer,
          type: res.type,
          mode: res.mode,
          token: res.token,
          serverUrl: res.serverUrl,
        });
      });
    },
    [socket, pushToast]
  );

  const leaveActive = useCallback(() => {
    const cur = callRef.current;
    if (cur.phase !== "active") return;
    socket?.emit("call:end", { callId: cur.callId });
    setCall({ phase: "idle" });
  }, [socket]);

  const value = useMemo(
    () => ({ busy: call.phase !== "idle", startCall }),
    [call.phase, startCall]
  );

  return (
    <CallContext.Provider value={value}>
      {children}

      {call.phase === "incoming" && (
        <div className="call-modal-backdrop">
          <div className="call-modal" role="alertdialog" aria-label="Incoming call">
            <Avatar id={call.peer.id} name={call.peer.displayName} avatarUrl={call.peer.avatarUrl} size={88} />
            <h2>{call.peer.displayName}</h2>
            <p>Incoming {call.type} call...</p>
            <div className="call-actions">
              {call.type === "video" ? (
                <>
                  <button className="btn-success" onClick={() => acceptIncoming("video")}>
                    <VideoIcon size={16} />
                    Accept video
                  </button>
                  <button className="btn-secondary" onClick={() => acceptIncoming("audio")}>
                    <PhoneIcon size={16} />
                    Answer audio only
                  </button>
                </>
              ) : (
                <button className="btn-success" onClick={() => acceptIncoming("audio")}>
                  <PhoneIcon size={16} />
                  Accept audio
                </button>
              )}
              <button className="btn-danger" onClick={rejectIncoming}>
                <PhoneOffIcon size={16} />
                Decline
              </button>
            </div>
          </div>
        </div>
      )}

      {call.phase === "outgoing" && (
        <div className="call-modal-backdrop">
          <div className="call-modal" role="dialog" aria-label="Outgoing call">
            <Avatar id={call.peer.id} name={call.peer.displayName} avatarUrl={call.peer.avatarUrl} size={88} />
            <h2>{call.peer.displayName}</h2>
            <p>{call.ringing ? "Ringing..." : "Calling..."}</p>
            <p className="call-kind">{call.type === "video" ? "Video call" : "Audio call"}</p>
            <div className="call-actions">
              <button className="btn-danger" onClick={cancelOutgoing}>
                <PhoneOffIcon size={16} />
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {call.phase === "active" && (
        <ActiveCall
          key={call.callId}
          token={call.token}
          serverUrl={call.serverUrl}
          type={call.type}
          mode={call.mode}
          peer={call.peer}
          onLeave={leaveActive}
          onError={(m) => pushToast(m, "error")}
        />
      )}
    </CallContext.Provider>
  );
}

export function useCall(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall must be used inside <CallProvider>");
  return ctx;
}
