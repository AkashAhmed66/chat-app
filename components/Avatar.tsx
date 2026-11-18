"use client";

import { useState } from "react";
import { formatMediaUrl } from "@/lib/format";

const COLORS = ["#3B5BDB", "#0B7285", "#277A38", "#B25E09", "#A61E4D", "#6741D9", "#C92A2A", "#087F5B"];

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

export default function Avatar({
  id,
  name,
  avatarUrl,
  size = 40,
  online,
  onClick,
}: {
  id: string;
  name: string;
  avatarUrl?: string | null;
  size?: number;
  /** undefined hides the presence dot */
  online?: boolean;
  onClick?: () => void;
}) {
  const [imgError, setImgError] = useState(false);

  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "?";

  const resolvedUrl = avatarUrl ? formatMediaUrl(avatarUrl) : null;
  const showImg = resolvedUrl && !imgError;

  return (
    <span
      className={`avatar ${onClick ? "avatar-clickable" : ""}`}
      style={{ width: size, height: size, cursor: onClick ? "pointer" : undefined }}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      title={onClick ? `View ${name}'s profile` : undefined}
    >
      {showImg ? (
        <img
          src={resolvedUrl}
          alt={name}
          className="avatar-img"
          style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover" }}
          onError={() => setImgError(true)}
        />
      ) : (
        <span
          className="avatar-circle"
          style={{ background: COLORS[hash(id) % COLORS.length], fontSize: size * 0.38 }}
        >
          {initials}
        </span>
      )}
      {online !== undefined && (
        <span
          className={`presence-dot ${online ? "is-online" : ""}`}
          title={online ? "Online" : "Offline"}
        />
      )}
    </span>
  );
}
