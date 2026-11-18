"use client";

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "warning" | "error";
}

export default function Toasts({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} className={`toast toast-${t.kind}`} onClick={() => onDismiss(t.id)}>
          <span className="toast-dot" aria-hidden="true" />
          <span className="toast-text">{t.text}</span>
        </button>
      ))}
    </div>
  );
}
