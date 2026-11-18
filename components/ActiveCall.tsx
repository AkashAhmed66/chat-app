"use client";

import {
  ControlBar,
  GridLayout,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useConnectionState,
  useTracks,
} from "@livekit/components-react";
import { ConnectionState, Track } from "livekit-client";
import { useEffect, useState } from "react";
import type { CallType, User } from "@/lib/types";
import Avatar from "./Avatar";

interface ActiveCallProps {
  token: string;
  serverUrl: string;
  /** What kind of call this is (decides the UI). */
  type: CallType;
  /** Whether *I* publish video (a callee may answer a video call as audio-only). */
  mode: CallType;
  peer: User;
  onLeave: () => void;
  onError: (message: string) => void;
}

export default function ActiveCall({
  token,
  serverUrl,
  type,
  mode,
  peer,
  onLeave,
  onError,
}: ActiveCallProps) {
  return (
    <div className="call-screen">
      <LiveKitRoom
        token={token}
        serverUrl={serverUrl}
        connect={true}
        audio={true}
        video={mode === "video"}
        data-lk-theme="default"
        className="call-room"
        onDisconnected={onLeave}
        onError={() => onError("Connection to the call failed")}
        onMediaDeviceFailure={() =>
          onError("Could not access your microphone or camera. Check browser permissions.")
        }
      >
        <CallBody type={type} peer={peer} />
        <RoomAudioRenderer />
        <div className="call-controls">
          <ControlBar
            controls={{
              microphone: true,
              camera: type === "video",
              screenShare: false,
              chat: false,
              settings: false,
              leave: true,
            }}
          />
        </div>
      </LiveKitRoom>
    </div>
  );
}

function useCallTimer(running: boolean): string {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [running]);
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function CallBody({ type, peer }: { type: CallType; peer: User }) {
  const state = useConnectionState();
  const connected = state === ConnectionState.Connected;
  const timer = useCallTimer(connected);

  return (
    <div className="call-body">
      <div className="call-header">
        <strong>{peer.displayName}</strong>
        <span className="call-timer">{connected ? timer : "Connecting..."}</span>
      </div>
      {type === "video" ? (
        <VideoGrid />
      ) : (
        <div className="audio-call">
          <div className="audio-call-avatar">
            <Avatar id={peer.id} name={peer.displayName} avatarUrl={peer.avatarUrl} size={128} />
          </div>
          <h2>{peer.displayName}</h2>
          <p>{connected ? "Audio call" : "Connecting..."}</p>
        </div>
      )}
    </div>
  );
}

function VideoGrid() {
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: false });
  return (
    <div className="video-grid">
      <GridLayout tracks={tracks}>
        <ParticipantTile />
      </GridLayout>
    </div>
  );
}
