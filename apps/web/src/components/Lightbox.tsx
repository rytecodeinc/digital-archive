import { useEffect, useRef } from "react";
import type { TimelineItem } from "../lib/api";

export function Lightbox({
  items,
  index,
  onClose,
  onNavigate,
}: {
  items: TimelineItem[];
  index: number;
  onClose: () => void;
  onNavigate: (nextIndex: number) => void;
}) {
  const item = items[index];
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onNavigate(Math.max(0, index - 1));
      if (e.key === "ArrowRight") onNavigate(Math.min(items.length - 1, index + 1));
    }

    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [index, items.length, onClose, onNavigate]);

  if (!item) return null;

  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;
  const src = item.preview_url || item.thumb_url;

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={item.caption || "Photo viewer"}
      onClick={onClose}
    >
      <div className="lightbox-chrome" onClick={(e) => e.stopPropagation()}>
        <button
          ref={closeRef}
          className="lightbox-close"
          type="button"
          aria-label="Close"
          onClick={onClose}
        >
          ×
        </button>

        {hasPrev ? (
          <button
            className="lightbox-nav lightbox-prev"
            type="button"
            aria-label="Previous photo"
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
          {index + 1} / {items.length}
        </div>
      </div>
    </div>
  );
}
