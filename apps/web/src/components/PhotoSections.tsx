import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { TimelineItem } from "../lib/api";
import { groupTimelineByDay } from "../lib/timelineGroups";
import { JustifiedDayGrid } from "./JustifiedDayGrid";

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"
      />
    </svg>
  );
}

export function PhotoSections({
  items,
  getDate,
  selectedIds,
  onSelectedIdsChange,
  forceSelectionMode = false,
  lightboxEnabled = true,
}: {
  items: TimelineItem[];
  getDate?: (item: TimelineItem) => string;
  selectedIds: Set<string>;
  onSelectedIdsChange: (next: Set<string>) => void;
  /** When true, clicks always toggle selection (e.g. album add-picker). */
  forceSelectionMode?: boolean;
  /** When false, photos never open the photo page. */
  lightboxEnabled?: boolean;
  canDelete?: boolean;
  onDelete?: (id: string) => Promise<void> | void;
  returnPath?: string;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [hoveredSectionKey, setHoveredSectionKey] = useState<string | null>(null);

  const dayGroups = useMemo(
    () => groupTimelineByDay(items, new Date(), getDate),
    [items, getDate],
  );
  const selectionActive = selectedIds.size > 0;
  const inSelectionMode = forceSelectionMode || selectionActive;
  const returnPath =
    location.pathname.startsWith("/albums/")
      ? location.pathname
      : location.pathname.startsWith("/trash")
        ? "/trash"
        : "/photos";

  function toggleSelect(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedIdsChange(next);
  }

  function toggleSection(ids: string[]) {
    const next = new Set(selectedIds);
    const allSelected = ids.every((id) => next.has(id));
    if (allSelected) {
      for (const id of ids) next.delete(id);
    } else {
      for (const id of ids) next.add(id);
    }
    onSelectedIdsChange(next);
  }

  function openItem(item: TimelineItem) {
    if (inSelectionMode) {
      toggleSelect(item.id);
      return;
    }
    if (!lightboxEnabled || !item.public_id) return;
    navigate(`/photo/${item.public_id}`, { state: { from: returnPath } });
  }

  return (
    <div className="timeline-days">
      {dayGroups.map((group) => {
        const groupIds = group.items.map((item) => item.id);
        const selectedInGroup = groupIds.filter((id) =>
          selectedIds.has(id),
        ).length;
        const allSelected =
          groupIds.length > 0 && selectedInGroup === groupIds.length;
        const someSelected = selectedInGroup > 0 && !allSelected;
        const showSectionCheck =
          hoveredSectionKey === group.key || selectedInGroup > 0;

        return (
          <section
            className={`day-section${showSectionCheck ? " is-hovering" : ""}`}
            key={group.key}
            onMouseEnter={() => setHoveredSectionKey(group.key)}
            onMouseLeave={() =>
              setHoveredSectionKey((current) =>
                current === group.key ? null : current,
              )
            }
          >
            <div className="day-header-row">
              <button
                className={`section-check${allSelected ? " is-checked" : ""}${
                  someSelected ? " is-partial" : ""
                }${showSectionCheck ? " is-visible" : ""}`}
                type="button"
                aria-label={
                  allSelected
                    ? `Deselect all photos from ${group.label}`
                    : `Select all photos from ${group.label}`
                }
                aria-pressed={allSelected}
                onClick={() => toggleSection(groupIds)}
              >
                <CheckIcon />
              </button>
              <h2 className="day-header">{group.label}</h2>
            </div>
            <JustifiedDayGrid
              items={group.items}
              selectedIds={selectedIds}
              selectionActive={inSelectionMode}
              onToggleSelect={toggleSelect}
              onOpen={openItem}
            />
          </section>
        );
      })}
    </div>
  );
}
