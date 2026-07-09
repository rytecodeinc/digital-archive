import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  api,
  type AlbumSummary,
  type TimelineItem,
  type User,
} from "../lib/api";
import { groupTimelineByDay } from "../lib/timelineGroups";
import { JustifiedDayGrid } from "../components/JustifiedDayGrid";
import { LibraryShell } from "../components/LibraryShell";

function PlusIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"
      />
    </svg>
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

export function AlbumDetailPage({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => Promise<void>;
}) {
  const { albumId } = useParams<{ albumId: string }>();
  const [album, setAlbum] = useState<AlbumSummary | null>(null);
  const [albumItems, setAlbumItems] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const [picking, setPicking] = useState(false);
  const [libraryItems, setLibraryItems] = useState<TimelineItem[]>([]);
  const [libraryCursor, setLibraryCursor] = useState<string | null>(null);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [hoveredSectionKey, setHoveredSectionKey] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const dayGroups = useMemo(
    () => groupTimelineByDay(libraryItems),
    [libraryItems],
  );
  const albumDayGroups = useMemo(
    () => groupTimelineByDay(albumItems),
    [albumItems],
  );
  const selectedCount = selectedIds.size;
  const selectionActive = selectedCount > 0;
  const inAlbumSelection = !picking && selectionActive;

  async function loadAlbum(id: string) {
    const [albumRes, mediaRes] = await Promise.all([
      api.album(id),
      api.albumMedia(id),
    ]);
    setAlbum(albumRes.album);
    setAlbumItems(mediaRes.items);
  }

  useEffect(() => {
    if (!albumId) {
      setError("Album not found");
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setStatus(null);
    setAlbum(null);
    setAlbumItems([]);
    setPicking(false);
    setSelectedIds(new Set());
    setHoveredSectionKey(null);

    loadAlbum(albumId)
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load album");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [albumId]);

  async function loadLibrary(initial = false) {
    setLibraryLoading(true);
    setError(null);
    try {
      const res = await api.timeline(initial ? null : libraryCursor);
      setLibraryItems((prev) => (initial ? res.items : [...prev, ...res.items]));
      setLibraryCursor(res.next_cursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load photos");
    } finally {
      setLibraryLoading(false);
    }
  }

  async function startPicking() {
    if (!album) return;
    setPicking(true);
    setSelectedIds(new Set());
    setHoveredSectionKey(null);
    setStatus(null);
    setError(null);
    setLibraryItems([]);
    setLibraryCursor(null);
    setLibraryLoading(true);
    try {
      const res = await api.timeline(null);
      setLibraryItems(res.items);
      setLibraryCursor(res.next_cursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load photos");
      setPicking(false);
    } finally {
      setLibraryLoading(false);
    }
  }

  function cancelPicking() {
    if (adding) return;
    setPicking(false);
    setSelectedIds(new Set());
    setHoveredSectionKey(null);
    setLibraryItems([]);
    setLibraryCursor(null);
    setStatus(null);
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setHoveredSectionKey(null);
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSection(ids: string[]) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = ids.every((id) => next.has(id));
      if (allSelected) {
        for (const id of ids) next.delete(id);
      } else {
        for (const id of ids) next.add(id);
      }
      return next;
    });
  }

  function renderDaySections(
    groups: ReturnType<typeof groupTimelineByDay>,
    options: { forceSelectionMode?: boolean } = {},
  ) {
    const forceSelectionMode = options.forceSelectionMode ?? false;
    return groups.map((group) => {
      const groupIds = group.items.map((item) => item.id);
      const selectedInGroup = groupIds.filter((id) => selectedIds.has(id)).length;
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
            selectionActive={forceSelectionMode || selectionActive}
            onToggleSelect={toggleSelect}
            onOpen={(item) => {
              if (forceSelectionMode || selectionActive) {
                toggleSelect(item.id);
              }
            }}
          />
        </section>
      );
    });
  }

  async function confirmAdd() {
    if (!albumId || !selectedCount) return;
    setAdding(true);
    setError(null);
    try {
      setStatus(
        selectedCount === 1
          ? "Adding 1 photo to album…"
          : `Adding ${selectedCount} photos to album…`,
      );
      const res = await api.addAlbumMedia(albumId, [...selectedIds]);
      await loadAlbum(albumId);
      setPicking(false);
      setSelectedIds(new Set());
      setLibraryItems([]);
      setLibraryCursor(null);
      setStatus(
        res.added_count === 0
          ? "Selected photos were already in this album"
          : res.added_count === 1
            ? "Added 1 photo to album"
            : `Added ${res.added_count} photos to album`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add photos");
    } finally {
      setAdding(false);
    }
  }

  return (
    <LibraryShell
      user={user}
      nav="albums"
      contentLabel={album?.title || "Album"}
      onLogout={onLogout}
      heading={
        <>
          {picking || inAlbumSelection ? (
            <div className="selection-heading">
              <button
                className="selection-clear"
                type="button"
                aria-label={
                  picking ? "Cancel adding photos" : "Clear selection"
                }
                title={picking ? "Cancel" : "Clear selection"}
                disabled={adding}
                onClick={picking ? cancelPicking : clearSelection}
              >
                <CloseIcon />
              </button>
              <h1 className="selection-count">
                {picking
                  ? selectedCount > 0
                    ? `${selectedCount} Selected`
                    : "Select photos"
                  : `${selectedCount} Selected`}
              </h1>
            </div>
          ) : (
            <h1 className="page-heading">
              {loading ? "Album" : album?.title || "Album"}
            </h1>
          )}
          {error ? (
            <p className="topbar-message is-error" role="alert">
              {error}
            </p>
          ) : status ? (
            <p className="topbar-message" role="status">
              {status}
            </p>
          ) : null}
        </>
      }
      actions={
        picking ? (
          <button
            className="btn"
            type="button"
            disabled={!selectedCount || adding}
            onClick={() => void confirmAdd()}
          >
            {adding
              ? "Adding…"
              : selectedCount
                ? `Add${selectedCount > 0 ? ` (${selectedCount})` : ""}`
                : "Add"}
          </button>
        ) : (
          <button
            className="icon-btn"
            type="button"
            aria-label="Add photos to album"
            title="Add photos"
            disabled={!album || loading}
            onClick={() => void startPicking()}
          >
            <PlusIcon />
          </button>
        )
      }
    >
      {picking ? (
        libraryLoading && libraryItems.length === 0 ? (
          <p className="muted content-status">Loading photos…</p>
        ) : libraryItems.length === 0 ? (
          <div className="empty">
            <h2>No photos to add</h2>
            <p className="muted">
              Upload photos in Photos first, then attach them to this album.
            </p>
            <Link className="btn secondary" to="/photos">
              Go to Photos
            </Link>
          </div>
        ) : (
          <>
            <div className="timeline-days">
              {renderDaySections(dayGroups, { forceSelectionMode: true })}
            </div>
            {libraryCursor ? (
              <div className="load-more">
                <button
                  className="btn secondary"
                  type="button"
                  disabled={libraryLoading || adding}
                  onClick={() => void loadLibrary(false)}
                >
                  {libraryLoading ? "Loading…" : "Load more"}
                </button>
              </div>
            ) : null}
          </>
        )
      ) : loading ? (
        <p className="muted content-status">Loading album…</p>
      ) : error || !album ? (
        <div className="empty">
          <h2>Album not found</h2>
          <p className="muted">
            This album may have been deleted, or the link is invalid.
          </p>
          <Link className="btn secondary" to="/albums">
            Back to Albums
          </Link>
        </div>
      ) : albumItems.length === 0 ? (
        <div className="empty">
          <h2>No photos in this album</h2>
          <p className="muted">
            Photos you add to “{album.title}” will appear here. They stay in
            Photos — albums only reference them.
          </p>
          <button className="btn" type="button" onClick={() => void startPicking()}>
            Add photos
          </button>
        </div>
      ) : (
        <div className="timeline-days">{renderDaySections(albumDayGroups)}</div>
      )}
    </LibraryShell>
  );
}
