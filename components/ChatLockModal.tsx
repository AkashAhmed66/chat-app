"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { ChatLockStatus, Friend } from "@/lib/types";
import { EyeIcon, EyeOffIcon, KeyIcon, LockIcon, ShieldIcon, UnlockIcon, XIcon } from "./Icons";
import { useRealtime } from "./RealtimeProvider";

export default function ChatLockModal({
  friend,
  lockStatus,
  onClose,
  onStatusChanged,
  onLockedImmediately,
}: {
  friend: Friend;
  lockStatus: ChatLockStatus;
  onClose: () => void;
  onStatusChanged: (status: ChatLockStatus) => void;
  onLockedImmediately?: () => void;
}) {
  const { pushToast } = useRealtime();

  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [view, setView] = useState<"default" | "remove">("default");

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault();
    const clean = password.trim();
    if (clean.length < 3) {
      pushToast("Password must be at least 3 characters", "warning");
      return;
    }

    setSubmitting(true);
    try {
      const res = await api<{ ok: boolean; status: "requested" }>(
        `/api/chat-lock/${friend.id}/request`,
        {
          method: "POST",
          body: { password: clean },
        }
      );
      onStatusChanged({
        status: res.status,
        isRequester: true,
        requesterName: "You",
      });
      pushToast(`Password protection request sent to ${friend.displayName}!`, "info");
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to request password protection";
      pushToast(msg, "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAccept(e: React.FormEvent) {
    e.preventDefault();
    const clean = password.trim();
    if (!clean) {
      pushToast("Please enter the password", "warning");
      return;
    }

    setSubmitting(true);
    try {
      await api<{ ok: boolean; status: "active" }>(`/api/chat-lock/${friend.id}/accept`, {
        method: "POST",
        body: { password: clean },
      });
      onStatusChanged({
        status: "active",
        isRequester: false,
        requesterName: null,
      });
      pushToast("Chat protection activated! Both passwords matched.", "info");
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to accept password protection";
      pushToast(msg, "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancelRequest() {
    setSubmitting(true);
    try {
      await api(`/api/chat-lock/${friend.id}/cancel`, { method: "POST" });
      onStatusChanged({ status: "none", isRequester: false, requesterName: null });
      pushToast("Protection request cancelled", "info");
      onClose();
    } catch {
      pushToast("Could not cancel request", "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove(e: React.FormEvent) {
    e.preventDefault();
    const clean = password.trim();
    if (!clean) {
      pushToast("Please enter the current password", "warning");
      return;
    }

    setSubmitting(true);
    try {
      await api(`/api/chat-lock/${friend.id}/remove`, {
        method: "POST",
        body: { password: clean },
      });
      onStatusChanged({ status: "none", isRequester: false, requesterName: null });
      pushToast("Password protection removed from this chat", "info");
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to remove protection";
      pushToast(msg, "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div className="modal-title-with-icon">
            <ShieldIcon size={20} />
            <h3>Chat Password Protection</h3>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <XIcon size={18} />
          </button>
        </header>

        {lockStatus.status === "none" && (
          <form onSubmit={handleRequest} className="chat-lock-form">
            <p className="modal-description">
              Secure your conversation with <strong>{friend.displayName}</strong>. Enter a password below.
              A request will be sent to them. When they enter the <em>same password</em>, this chat will be locked for both of you.
            </p>

            <div className="form-group">
              <label htmlFor="lock-password">Set Chat Password</label>
              <div className="password-input-wrapper">
                <input
                  id="lock-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter a secret password"
                  required
                  minLength={3}
                  maxLength={50}
                  autoFocus
                />
                <button
                  type="button"
                  className="icon-btn-toggle-eye"
                  onClick={() => setShowPassword((p) => !p)}
                  title={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                </button>
              </div>
            </div>

            <div className="modal-footer">
              <button type="button" className="btn-ghost" onClick={onClose} disabled={submitting}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={submitting || !password.trim()}>
                {submitting ? "Sending..." : "Set & Send Request"}
              </button>
            </div>
          </form>
        )}

        {lockStatus.status === "requested" && !lockStatus.isRequester && (
          <form onSubmit={handleAccept} className="chat-lock-form">
            <p className="modal-description">
              <strong>{friend.displayName}</strong> has requested to password-protect this conversation.
              Please enter the agreed password to confirm and activate chat protection.
            </p>

            <div className="form-group">
              <label htmlFor="accept-password">Enter Agreed Password</label>
              <div className="password-input-wrapper">
                <input
                  id="accept-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter the same password"
                  required
                  autoFocus
                />
                <button
                  type="button"
                  className="icon-btn-toggle-eye"
                  onClick={() => setShowPassword((p) => !p)}
                  title={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                </button>
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn-ghost btn-text-danger"
                onClick={handleCancelRequest}
                disabled={submitting}
              >
                Decline
              </button>
              <button type="submit" className="btn-primary" disabled={submitting || !password.trim()}>
                {submitting ? "Verifying..." : "Accept & Lock Chat"}
              </button>
            </div>
          </form>
        )}

        {lockStatus.status === "requested" && lockStatus.isRequester && (
          <div className="chat-lock-pending">
            <div className="pending-icon-box">
              <KeyIcon size={32} />
            </div>
            <h4>Waiting for {friend.displayName}</h4>
            <p>
              You have requested password protection. Once {friend.displayName} accepts and enters the matching password, the chat will be locked.
            </p>
            <div className="modal-footer">
              <button
                type="button"
                className="btn-danger btn-small"
                onClick={handleCancelRequest}
                disabled={submitting}
              >
                Cancel Request
              </button>
            </div>
          </div>
        )}

        {lockStatus.status === "active" && view === "default" && (
          <div className="chat-lock-active-manage">
            <div className="active-lock-header">
              <div className="lock-badge-large">
                <LockIcon size={24} />
              </div>
              <h4>Chat is Password-Protected</h4>
              <p>Every time this chat is opened, the password is required to view messages.</p>
            </div>

            <div className="active-lock-actions">
              <button
                type="button"
                className="btn-secondary btn-block"
                onClick={() => {
                  if (onLockedImmediately) onLockedImmediately();
                  onClose();
                }}
              >
                <LockIcon size={16} />
                Lock Chat Now
              </button>

              <button
                type="button"
                className="btn-ghost btn-text-danger btn-block"
                onClick={() => setView("remove")}
              >
                <UnlockIcon size={16} />
                Remove Password Protection
              </button>
            </div>
          </div>
        )}

        {lockStatus.status === "active" && view === "remove" && (
          <form onSubmit={handleRemove} className="chat-lock-form">
            <p className="modal-description">
              To remove password protection from this chat, please enter the current password:
            </p>

            <div className="form-group">
              <label htmlFor="remove-password">Current Password</label>
              <div className="password-input-wrapper">
                <input
                  id="remove-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter current password"
                  required
                  autoFocus
                />
                <button
                  type="button"
                  className="icon-btn-toggle-eye"
                  onClick={() => setShowPassword((p) => !p)}
                  title={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                </button>
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setView("default")}
                disabled={submitting}
              >
                Back
              </button>
              <button
                type="submit"
                className="btn-danger"
                disabled={submitting || !password.trim()}
              >
                {submitting ? "Removing..." : "Remove Protection"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
