"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";
import Avatar from "./Avatar";
import { useCall } from "./CallProvider";
import { MessageIcon, PhoneIcon, VideoIcon, XIcon } from "./Icons";
import ImageLightbox from "./ImageLightbox";
import { useRealtime } from "./RealtimeProvider";

interface FullUserProfile extends User {
  relationship?: "none" | "friend" | "outgoing" | "incoming";
  online?: boolean;
}

export default function UserProfileModal({
  user: initialUser,
  onClose,
  onOpenChat,
}: {
  user: User;
  onClose: () => void;
  onOpenChat?: (userId: string) => void;
}) {
  const { onlineIds } = useRealtime();
  const { busy, startCall } = useCall();
  const [profile, setProfile] = useState<FullUserProfile>(initialUser);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const online = onlineIds.has(profile.id);

  useEffect(() => {
    let cancelled = false;
    api<{ user: FullUserProfile }>(`/api/users/${initialUser.id}`)
      .then((d) => {
        if (!cancelled && d.user) setProfile((prev) => ({ ...prev, ...d.user }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [initialUser.id]);

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
        <div className="modal-card user-profile-card" onClick={(e) => e.stopPropagation()}>
          <header className="modal-header">
            <h3>Profile Info</h3>
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <XIcon size={18} />
            </button>
          </header>

          <div className="user-profile-body">
            <div
              className="user-profile-avatar-box"
              onClick={() => profile.avatarUrl && setLightboxOpen(true)}
              title={profile.avatarUrl ? "Click to view full photo" : undefined}
              style={{ cursor: profile.avatarUrl ? "pointer" : "default" }}
            >
              <Avatar
                id={profile.id}
                name={profile.displayName}
                avatarUrl={profile.avatarUrl}
                size={96}
                online={online}
              />
              {profile.avatarUrl && (
                <span className="view-photo-hint">Click to enlarge</span>
              )}
            </div>

            <div className="user-profile-names">
              <h2>{profile.displayName}</h2>
              <span className="user-profile-handle">@{profile.username}</span>
              <span className={`status-pill ${online ? "status-online" : "status-offline"}`}>
                {online ? "Online" : "Offline"}
              </span>
            </div>

            <div className="user-profile-bio-box">
              <label>About</label>
              <p>{profile.bio || "No status set."}</p>
            </div>

            <div className="user-profile-actions">
              {onOpenChat && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    onOpenChat(profile.id);
                    onClose();
                  }}
                >
                  <MessageIcon size={16} />
                  Message
                </button>
              )}
              <button
                type="button"
                className="btn-secondary"
                disabled={busy || !online}
                title={online ? "Start audio call" : "User is offline"}
                onClick={() => {
                  startCall(profile, "audio");
                  onClose();
                }}
              >
                <PhoneIcon size={16} />
                Audio Call
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={busy || !online}
                title={online ? "Start video call" : "User is offline"}
                onClick={() => {
                  startCall(profile, "video");
                  onClose();
                }}
              >
                <VideoIcon size={16} />
                Video Call
              </button>
            </div>
          </div>
        </div>
      </div>

      {lightboxOpen && profile.avatarUrl && (
        <ImageLightbox
          src={profile.avatarUrl}
          alt={`${profile.displayName}'s Profile Photo`}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </>
  );
}
