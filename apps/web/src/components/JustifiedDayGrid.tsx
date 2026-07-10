import { useEffect, useMemo, useRef, useState } from "react";
import type { TimelineItem } from "../lib/api";
import { buildJustifiedRows } from "../lib/justifiedLayout";

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M9.0 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"
      />
    </svg>
  );
}

export function JustifiedDayGrid({
  items,
  selectedIds,
  selectionActive,
  onOpen,
  onToggleSelect,
}: {
  items: TimelineItem[];
  selectedIds: Set<string>;
  selectionActive: boolean;
  onOpen: (item: TimelineItem) => void;
  onToggleSelect: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => setWidth(el.clientWidth);
    update();

    const observer = new ResizeObserver(() => update());
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const isMobile = width > 0 && width < 640;
  const rows = useMemo(
    () =>
      buildJustifiedRows(items, width, {
        targetRowHeight: isMobile ? 140 : 220,
        gap: isMobile ? 4 : 6,
        maxRowHeight: isMobile ? 220 : 320,
      }),
    [items, width, isMobile],
  );

  return (
    <div className="justified-grid" ref={containerRef}>
      {width === 0
        ? null
        : rows.map((row, rowIndex) => (
            <div
              className="justified-row"
              key={`row-${rowIndex}-${row.tiles[0]?.item.id ?? rowIndex}`}
              style={{ height: `${row.height}px` }}
            >
              {row.tiles.map((tile, index) => {
                const selected = selectedIds.has(tile.item.id);
                return (
                  <div
                    className={`tile${selected ? " is-selected" : ""}${
                      selectionActive ? " selection-mode" : ""
                    }`}
                    key={tile.item.id}
                    style={{
                      width: `${tile.width}px`,
                      height: `${tile.height}px`,
                      animationDelay: `${Math.min(index, 12) * 30}ms`,
                    }}
                  >
                    <button
                      className="tile-open"
                      type="button"
                      onClick={() => {
                        if (selectionActive) {
                          onToggleSelect(tile.item.id);
                          return;
                        }
                        onOpen(tile.item);
                      }}
                      aria-label={
                        selectionActive
                          ? selected
                            ? "Deselect photo"
                            : "Select photo"
                          : tile.item.caption || "Open photo"
                      }
                    >
                      <img
                        src={tile.item.thumb_url}
                        alt={tile.item.caption || "Archive photo"}
                        loading="lazy"
                      />
                    </button>
                    <button
                      className={`select-check${selected ? " is-checked" : ""}`}
                      type="button"
                      aria-label={selected ? "Deselect photo" : "Select photo"}
                      aria-pressed={selected}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSelect(tile.item.id);
                      }}
                    >
                      <CheckIcon />
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
    </div>
  );
}
