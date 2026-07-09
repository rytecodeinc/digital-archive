import { useEffect, useRef, useState } from "react";
import { api, type TimelineItem } from "../lib/api";

export function Lightbox({
  items,
  index,
  onClose,
  onNavigate,
  onDelete,
}: {
  items: TimelineItem[];
  index: number;
  onClose: () => void;
  onNavigate: (nextIndex: number) => void;
  onDelete: (id: string) => Promise<void> | void;
}) {
  const item = items[index];
  const closeRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState<"download" | "delete" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    setActionError(null);

    function onKey(e: KeyboardEvent) {
      if (busy) return;
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onNavigate(Math.max(0, index - 1));
      if (e.key === "ArrowRight") onNavigate(Math.min(items.length - 1, index + 1));
    }

    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [busy, index, items.length, onClose, onNavigate]);

  if (!item) return null;

  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;
  const src = item.preview_url || item.thumb_url;

  async function handleDownload() {
    setBusy("download");
    setActionError(null);
    try {
      const { download_url, filename } = await api.downloadMedia(item.id);
      const res = await fetch(download_url, { credentials: "include" });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this photo from the archive?")) return;
    setBusy("delete");
    setActionError(null);
    try {
      await onDelete(item.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={item.caption || "Photo viewer"}
      onClick={onClose}
    >
      <header className="lightbox-topbar" onClick={(e) => e.stopPropagation()}>
        <button
          ref={closeRef}
          className="lightbox-icon-btn"
          type="button"
          aria-label="Close"
          onClick={onClose}
        >
          <CloseIcon />
        </button>

        <div className="lightbox-topbar-actions">
          <button
            className="lightbox-icon-btn"
            type="button"
            aria-label="Download"
            title="Download"
            disabled={busy !== null}
            onClick={() => void handleDownload()}
          >
            <DownloadIcon />
          </button>
          <button
            className="lightbox-icon-btn lightbox-icon-danger"
            type="button"
            aria-label="Delete"
            title="Delete"
            disabled={busy !== null}
            onClick={() => void handleDelete()}
          >
            <TrashIcon />
          </button>
        </div>
      </header>

      <div className="lightbox-chrome" onClick={(e) => e.stopPropagation()}>
        {hasPrev ? (
          <button
            className="lightbox-nav lightbox-prev"
            type="button"
            aria-label="Previous photo"
            disabled={busy !== null}
            onClick={() => onNavigate(index - 1)}
          >
            ‹
          </button>
        ) : null}

        {hasNext ? (
          <button
            className="lightbox-nav lightbox-next"
            type="button"
            aria-label="Next photo"
            disabled={busy !== null}
            onClick={() => onNavigate(index + 1)}
          >
            ›
          </button>
        ) : null}

        <figure className="lightbox-figure">
          <img src={src} alt={item.caption || "Archive photo"} />
          {item.caption ? <figcaption>{item.caption}</figcaption> : null}
        </figure>

        <div className="lightbox-meta">
          {busy === "download"
            ? "Downloading…"
            : busy === "delete"
              ? "Deleting…"
              : `${index + 1} / ${items.length}`}
        </div>
        {actionError ? <p className="lightbox-error">{actionError}</p> : null}
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M18.3 5.71 12 12.01 5.7 5.7 4.29 7.11 10.59 13.4 4.29 19.7 5.7 21.11 12 14.82 18.29 21.11 19.7 19.7 13.41 13.4 19.71 7.11z"
      />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M5 20h14v-2H5v2zm7-18-5.5 5.5 1.41 1.42L11 6.83V16h2V6.83l3.09 3.09 1.41-1.42L12 2z"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M15 4V3H9v1H4v2h1v13c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V6h1V4h-5zm2 15H7V6h10v13zM9 8h2v9H9zm4 0h2v9h-2z"
      />
    </svg>
  );
}
