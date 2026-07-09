import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  api,
  type AlbumSummary,
  type TimelineItem,
  type User,
} from "../lib/api";
import { LibraryShell } from "../components/LibraryShell";
import { PhotoSections } from "../components/PhotoSections";

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

function TrashIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M15 4V3H9v1H4v2h1v13c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V6h1V4h-5zm2 15H7V6h10v13zM9 8h2v9H9zm4 0h2v9h-2z"
      />
    </svg>
  );
}

function RemoveFromAlbumIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M22 13h-4v4h-2v-4h-4v-2h4V7h2v4h4v2zm-8-8H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2v-3h-2v3H4V7h10v1h2V7c0-1.1-.9-2-2-2z"
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
  const [adding, setAdding] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removing, setRemoving] = useState(false);

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
    setRemoveOpen(false);

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
    setLibraryItems([]);
    setLibraryCursor(null);
    setStatus(null);
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setRemoveOpen(false);
  }

  useEffect(() => {
    if (!removeOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !removing) setRemoveOpen(false);
    }

    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [removeOpen, removing]);

  async function onDeleteFromAlbum(id: string) {
    await api.deleteMedia(id);
    setSelectedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setAlbumItems((prev) => prev.filter((item) => item.id !== id));
    setAlbum((prev) =>
      prev
        ? {
            ...prev,
            media_count: Math.max(0, prev.media_count - 1),
            photo_count: Math.max(0, prev.photo_count - 1),
          }
        : prev,
    );
  }

  async function onDeleteSelectedFromAlbum() {
    if (picking) return;
    const ids = [...selectedIds];
    if (!ids.length) return;
    const label =
      ids.length === 1
        ? "Move 1 photo to Trash?"
        : `Move ${ids.length} photos to Trash?`;
    if (!confirm(label)) return;

    setError(null);
    try {
      setStatus(
        ids.length === 1
          ? "Moving photo to Trash…"
          : `Moving ${ids.length} photos to Trash…`,
      );
      const res = await api.batchDeleteMedia(ids);
      const deleted = new Set(res.deleted_ids);
      setAlbumItems((prev) => prev.filter((item) => !deleted.has(item.id)));
      setAlbum((prev) =>
        prev
          ? {
              ...prev,
              media_count: Math.max(0, prev.media_count - res.deleted_count),
              photo_count: Math.max(0, prev.photo_count - res.deleted_count),
            }
          : prev,
      );
      setSelectedIds(new Set());
      setStatus(
        res.deleted_count === 1
          ? "Moved 1 photo to Trash"
          : `Moved ${res.deleted_count} photos to Trash`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to move to Trash");
    }
  }

  async function confirmRemoveFromAlbum() {
    if (!albumId || picking || !selectedCount) return;
    setRemoving(true);
    setError(null);
    try {
      const ids = [...selectedIds];
      setStatus(
        ids.length === 1
          ? "Removing photo from album…"
          : `Removing ${ids.length} photos from album…`,
      );
      const res = await api.removeAlbumMedia(albumId, ids);
      await loadAlbum(albumId);
      setSelectedIds(new Set());
      setRemoveOpen(false);
      setStatus(
        res.removed_count === 0
          ? "Selected photos were not in this album"
          : res.removed_count === 1
            ? "Removed 1 photo from album"
            : `Removed ${res.removed_count} photos from album`,
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to remove from album",
      );
    } finally {
      setRemoving(false);
    }
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
    <>
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
          <>
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
            {inAlbumSelection ? (
              <>
                <button
                  className="icon-btn"
                  type="button"
                  aria-label="Remove from album"
                  title="Remove from album"
                  onClick={() => setRemoveOpen(true)}
                >
                  <RemoveFromAlbumIcon />
                </button>
                <button
                  className="icon-btn"
                  type="button"
                  aria-label="Move selected to Trash"
                  title="Move to Trash"
                  onClick={() => void onDeleteSelectedFromAlbum()}
                >
                  <TrashIcon />
                </button>
              </>
            ) : null}
          </>
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
            <PhotoSections
              items={libraryItems}
              selectedIds={selectedIds}
              onSelectedIdsChange={setSelectedIds}
              forceSelectionMode
              lightboxEnabled={false}
            />
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
        <PhotoSections
          items={albumItems}
          selectedIds={selectedIds}
          onSelectedIdsChange={setSelectedIds}
          canDelete
          onDelete={onDeleteFromAlbum}
        />
      )}
    </LibraryShell>

      {removeOpen ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => {
            if (!removing) setRemoveOpen(false);
          }}
        >
          <div
            className="confirm-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-album-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="remove-album-title">
              {selectedCount === 1 ? "Remove item?" : `Remove ${selectedCount} items?`}
            </h2>
            <p className="muted">
              You will still be able to find{" "}
              {selectedCount === 1 ? "it" : "them"} in your Photos library
            </p>
            <div className="confirm-actions">
              <button
                className="confirm-btn"
                type="button"
                disabled={removing}
                onClick={() => setRemoveOpen(false)}
              >
                Cancel
              </button>
              <button
                className="confirm-btn"
                type="button"
                disabled={removing}
                onClick={() => void confirmRemoveFromAlbum()}
              >
                {removing ? "Removing…" : "Remove"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
