import { useEffect, useMemo, useRef, useState } from "react";
import type { TimelineItem } from "../lib/api";
import { buildJustifiedRows } from "../lib/justifiedLayout";

export function JustifiedDayGrid({
  items,
  onDelete,
  onOpen,
}: {
  items: TimelineItem[];
  onDelete: (id: string) => void;
  onOpen: (item: TimelineItem) => void;
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
              {row.tiles.map((tile, index) => (
                <div
                  className="tile"
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
                    onClick={() => onOpen(tile.item)}
                    aria-label={tile.item.caption || "Open photo"}
                  >
                    <img
                      src={tile.item.thumb_url}
                      alt={tile.item.caption || "Archive photo"}
                      loading="lazy"
                    />
                  </button>
                  <button
                    className="btn danger delete"
                    type="button"
                    onClick={() => onDelete(tile.item.id)}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          ))}
    </div>
  );
}
