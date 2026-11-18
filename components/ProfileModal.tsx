"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { API_URL } from "@/lib/config";
import type { User } from "@/lib/types";
import { useAuth } from "./AuthProvider";
import Avatar from "./Avatar";
import { CameraIcon, CheckIcon, XIcon } from "./Icons";
import { useRealtime } from "./RealtimeProvider";

export default function ProfileModal({ onClose }: { onClose: () => void }) {
  const { user, updateUser } = useAuth();
  const { pushToast } = useRealtime();

  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!user) return null;

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      pushToast("Please choose an image file (PNG, JPG, WebP, GIF)", "warning");
      return;
    }

    if (file.size > 6 * 1024 * 1024) {
      pushToast("Image is too large (max 6MB)", "warning");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`${API_URL}/api/upload/avatar`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || "Failed to upload avatar");
      }

      const data = await res.json();
      setAvatarUrl(data.avatarUrl);
      updateUser({ avatarUrl: data.avatarUrl });
      pushToast("Profile photo updated!", "info");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      pushToast(msg, "error");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function removeAvatar() {
    setAvatarUrl(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleanName = displayName.trim();
    if (!cleanName) {
      pushToast("Display name cannot be empty", "warning");
      return;
    }

    setSaving(true);
    try {
      const res = await api<{ user: User }>("/api/users/profile", {
        method: "PUT",
        body: {
          displayName: cleanName,
          bio: bio.trim(),
          avatarUrl: avatarUrl,
        },
      });

      updateUser(res.user);
      pushToast("Profile saved successfully", "info");
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update profile";
      pushToast(msg, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h3>Edit Profile</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <XIcon size={18} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="profile-form">
          <div className="profile-avatar-section">
            <div className="profile-avatar-wrapper">
              <Avatar id={user.id} name={displayName || user.displayName} avatarUrl={avatarUrl} size={88} />
              <button
                type="button"
                className="avatar-upload-badge"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                title="Change profile photo"
              >
                <CameraIcon size={16} />
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleFileChange}
            />
            <div className="profile-avatar-actions">
              <button
                type="button"
                className="btn-ghost btn-small"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? "Uploading..." : "Upload Photo"}
              </button>
              {avatarUrl && (
                <button
                  type="button"
                  className="btn-ghost btn-small btn-text-danger"
                  onClick={removeAvatar}
                  disabled={uploading}
                >
                  Remove
                </button>
              )}
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="profile-username">Username</label>
            <input
              id="profile-username"
              type="text"
              value={`@${user.username}`}
              disabled
              className="input-disabled"
            />
            <small className="field-hint">Usernames cannot be changed.</small>
          </div>

          <div className="form-group">
            <label htmlFor="profile-displayname">Display Name</label>
            <input
              id="profile-displayname"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={60}
              required
              placeholder="Your full name"
            />
          </div>

          <div className="form-group">
            <label htmlFor="profile-bio">About / Bio</label>
            <textarea
              id="profile-bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={250}
              rows={3}
              placeholder="Write a few words about yourself (status, hobbies, etc.)..."
            />
            <small className="field-hint">{250 - bio.length} characters remaining</small>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving || uploading}>
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
