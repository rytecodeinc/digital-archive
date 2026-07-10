import type { TimelineItem } from "./api";

export type JustifiedTile = {
  item: TimelineItem;
  width: number;
  height: number;
  aspectRatio: number;
};

export type JustifiedRow = {
  tiles: JustifiedTile[];
  height: number;
};

function aspectRatioOf(item: TimelineItem) {
  if (item.width && item.height && item.width > 0 && item.height > 0) {
    return item.width / item.height;
  }
  // Unknown dims: assume slightly landscape until metadata exists.
  return 4 / 3;
}

/**
 * Google Photos–style justified layout:
 * pack items into rows of roughly equal height, preserving natural aspect ratios.
 */
export function buildJustifiedRows(
  items: TimelineItem[],
  containerWidth: number,
  options?: {
    targetRowHeight?: number;
    gap?: number;
    maxRowHeight?: number;
  },
): JustifiedRow[] {
  const targetRowHeight = options?.targetRowHeight ?? 220;
  const gap = options?.gap ?? 6;
  const maxRowHeight = options?.maxRowHeight ?? 320;

  if (!items.length || containerWidth <= 0) return [];

  const rows: JustifiedRow[] = [];
  let current: TimelineItem[] = [];
  let aspectSum = 0;

  const flush = (force = false) => {
    if (!current.length) return;

    const gapsTotal = gap * Math.max(0, current.length - 1);
    const available = Math.max(1, containerWidth - gapsTotal);
    let height = available / aspectSum;

    // Don't stretch a short final row to full width.
    if (force && height > targetRowHeight * 1.15) {
      height = targetRowHeight;
    }
    height = Math.min(height, maxRowHeight);

    rows.push({
      height,
      tiles: current.map((item) => {
        const aspectRatio = aspectRatioOf(item);
        return {
          item,
          aspectRatio,
          height,
          width: height * aspectRatio,
        };
      }),
    });

    current = [];
    aspectSum = 0;
  };

  for (const item of items) {
    const ratio = aspectRatioOf(item);
    current.push(item);
    aspectSum += ratio;

    const gapsTotal = gap * Math.max(0, current.length - 1);
    const rowWidthAtTarget = aspectSum * targetRowHeight + gapsTotal;
    if (rowWidthAtTarget >= containerWidth) {
      flush(false);
    }
  }

  flush(true);
  return rows;
}
