"use client";

import { useEffect } from "react";
import { formatMediaUrl } from "@/lib/format";
import { DownloadIcon, XIcon } from "./Icons";

export default function ImageLightbox({
  src,
  alt = "Image preview",
  onClose,
}: {
  src: string;
  alt?: string;
  onClose: () => void;
}) {
  const fullUrl = formatMediaUrl(src);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="lightbox-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
        <header className="lightbox-header">
          <span className="lightbox-title truncate">{alt}</span>
          <div className="lightbox-actions">
            <a
              href={fullUrl}
              download
              target="_blank"
              rel="noopener noreferrer"
              className="icon-btn"
              title="Download full size"
            >
              <DownloadIcon size={18} />
            </a>
            <button className="icon-btn" onClick={onClose} title="Close" aria-label="Close">
              <XIcon size={18} />
            </button>
          </div>
        </header>
        <div className="lightbox-image-container">
          <img src={fullUrl} alt={alt} className="lightbox-img" />
        </div>
      </div>
    </div>
  );
}
