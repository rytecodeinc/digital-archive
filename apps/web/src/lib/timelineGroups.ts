import type { TimelineItem } from "./api";

export type TimelineDayGroup = {
  key: string;
  label: string;
  items: TimelineItem[];
};

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dayKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function daysBetween(a: Date, b: Date) {
  const ms = startOfLocalDay(a).getTime() - startOfLocalDay(b).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

/**
 * Google Photos–style day headers:
 * - Today → "Today"
 * - Yesterday → "Yesterday"
 * - Within the last 7 days → weekday only ("Tuesday")
 * - Older → "Fri, Jul 3" (same calendar year) or "Fri, Jul 3, 2024" (other years)
 */
export function formatDayHeader(date: Date, now = new Date()) {
  const diff = daysBetween(now, date);

  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";

  if (diff >= 2 && diff < 7) {
    return new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(date);
  }

  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
}

export function groupTimelineByDay(
  items: TimelineItem[],
  now = new Date(),
  getDate: (item: TimelineItem) => string = (item) =>
    item.taken_at || item.sort_at,
): TimelineDayGroup[] {
  const groups = new Map<string, TimelineDayGroup>();

  for (const item of items) {
    const raw = getDate(item);
    const date = new Date(raw);
    const key = dayKey(date);
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(key, {
        key,
        label: formatDayHeader(date, now),
        items: [item],
      });
    }
  }

  // Items arrive newest-first; preserve that order across groups.
  return [...groups.values()];
}
