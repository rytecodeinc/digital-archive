import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  readImageDimensions,
  sha256Hex,
  type AlbumSummary,
  type TimelineItem,
  type User,
} from "../lib/api";
import { LibraryShell } from "../components/LibraryShell";
import { PhotoSections } from "../components/PhotoSections";

export type LibraryView = "photos" | "trash";

function UploadIcon() {
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

function RestoreIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.95 8.95 0 0 0 13 21a9 9 0 0 0 0-18z"
      />
    </svg>
  );
}

function AddToAlbumIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9h-4v4h-2v-4H9V9h4V5h2v4h4v2z"
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

export function TimelinePage({
  user,
  view,
  onLogout,
}: {
  user: User;
  view: LibraryView;
  onLogout: () => Promise<void>;
}) {
  const isTrash = view === "trash";
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [choosingAlbum, setChoosingAlbum] = useState(false);
  const [albumChoices, setAlbumChoices] = useState<AlbumSummary[]>([]);
  const [albumsLoading, setAlbumsLoading] = useState(false);
  const [addingToAlbumId, setAddingToAlbumId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const getDate = useMemo(
    () => (item: TimelineItem) =>
      isTrash
        ? item.deleted_at || item.taken_at || item.sort_at
        : item.taken_at || item.sort_at,
    [isTrash],
  );
  const selectedCount = selectedIds.size;
  const selectionActive = selectedCount > 0;

  async function load(initial = false) {
    setError(null);
    try {
      const fetchPage = isTrash ? api.trash : api.timeline;
      const res = await fetchPage(initial ? null : nextCursor);
      setItems((prev) => (initial ? res.items : [...prev, ...res.items]));
      setNextCursor(res.next_cursor);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : isTrash
            ? "Failed to load trash"
            : "Failed to load timeline",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setItems([]);
    setNextCursor(null);
    setLoading(true);
    setStatus(null);
    setError(null);
    setSelectedIds(new Set());
    setChoosingAlbum(false);
    setAlbumChoices([]);
    setAddingToAlbumId(null);
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  function clearSelection() {
    setSelectedIds(new Set());
    setChoosingAlbum(false);
    setAlbumChoices([]);
    setAddingToAlbumId(null);
  }

  async function startChoosingAlbum() {
    if (isTrash || !selectedCount) return;
    setChoosingAlbum(true);
    setError(null);
    setStatus(null);
    setAlbumsLoading(true);
    try {
      const res = await api.albums();
      setAlbumChoices(res.albums);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load albums");
      setChoosingAlbum(false);
    } finally {
      setAlbumsLoading(false);
    }
  }

  function cancelChoosingAlbum() {
    if (addingToAlbumId) return;
    setChoosingAlbum(false);
    setAlbumChoices([]);
    setStatus(null);
  }

  async function addSelectedToAlbum(target: AlbumSummary) {
    if (!selectedCount || addingToAlbumId) return;
    setAddingToAlbumId(target.id);
    setError(null);
    try {
      setStatus(
        selectedCount === 1
          ? `Adding 1 photo to “${target.title}”…`
          : `Adding ${selectedCount} photos to “${target.title}”…`,
      );
      const res = await api.addAlbumMedia(target.id, [...selectedIds]);
      setChoosingAlbum(false);
      setAlbumChoices([]);
      setSelectedIds(new Set());
      setStatus(
        res.added_count === 0
          ? `Selected photos were already in “${target.title}”`
          : res.added_count === 1
            ? `Added 1 photo to “${target.title}”`
            : `Added ${res.added_count} photos to “${target.title}”`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add photos");
    } finally {
      setAddingToAlbumId(null);
    }
  }

  async function onFilesSelected(fileList: FileList | null) {
    if (!fileList?.length || isTrash) return;
    const files = [...fileList];
    setUploading(true);
    setError(null);
    let done = 0;

    try {
      for (const file of files) {
        setStatus(`Uploading ${done + 1} / ${files.length}: ${file.name}`);
        const mime =
          file.type ||
          (file.name.toLowerCase().endsWith(".heic")
            ? "image/heic"
            : file.name.toLowerCase().endsWith(".heif")
              ? "image/heif"
              : "");
        if (!mime.startsWith("image/")) {
          throw new Error(`Skipped non-image: ${file.name}`);
        }

        const [contentHash, dims] = await Promise.all([
          sha256Hex(file),
          readImageDimensions(file),
        ]);

        const session = await api.createUploadSession({
          mime_type: mime,
          byte_size: file.size,
          content_hash: contentHash,
          client_local_id: `${file.name}-${file.size}-${file.lastModified}`,
          taken_at: file.lastModified
            ? new Date(file.lastModified).toISOString()
            : undefined,
          width: dims?.width,
          height: dims?.height,
        });

        if (session.deduped) {
          done += 1;
          continue;
        }

        if (!session.media_id) {
          throw new Error("Upload session incomplete");
        }

        if (session.proxy_upload_url) {
          await api.uploadContent(session.proxy_upload_url, file, mime);
        } else if (session.upload_url && session.upload_headers) {
          const put = await fetch(session.upload_url, {
            method: "PUT",
            headers: session.upload_headers,
            body: file,
          });
          if (!put.ok) {
            throw new Error(`R2 upload failed for ${file.name} (${put.status})`);
          }
          await api.completeUpload(session.media_id);
        } else {
          throw new Error("Upload session incomplete");
        }

        done += 1;
      }

      setStatus(`Uploaded ${done} photo${done === 1 ? "" : "s"}`);
      setLoading(true);
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onDelete(id: string, options?: { skipConfirm?: boolean }) {
    if (isTrash) return;
    if (!options?.skipConfirm && !confirm("Move this photo to Trash?")) {
      return;
    }
    await api.deleteMedia(id);
    setSelectedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setItems((prev) => prev.filter((item) => item.id !== id));
  }

  async function onDeleteSelected() {
    if (isTrash) return;
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
      setItems((prev) => prev.filter((item) => !deleted.has(item.id)));
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

  async function onRestoreSelected() {
    if (!isTrash) return;
    const ids = [...selectedIds];
    if (!ids.length) return;

    setError(null);
    try {
      setStatus(
        ids.length === 1
          ? "Restoring photo…"
          : `Restoring ${ids.length} photos…`,
      );
      const res = await api.batchRestoreMedia(ids);
      const restored = new Set(res.restored_ids);
      setItems((prev) => prev.filter((item) => !restored.has(item.id)));
      setSelectedIds(new Set());
      setStatus(
        res.restored_count === 1
          ? "Restored 1 photo to Photos"
          : `Restored ${res.restored_count} photos to Photos`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restore photos");
    }
  }

  async function onPurgeSelected() {
    if (!isTrash) return;
    const ids = [...selectedIds];
    if (!ids.length) return;
    const label =
      ids.length === 1
        ? "Permanently delete this photo? This cannot be undone."
        : `Permanently delete ${ids.length} photos? This cannot be undone.`;
    if (!confirm(label)) return;

    setError(null);
    try {
      setStatus(
        ids.length === 1
          ? "Permanently deleting photo…"
          : `Permanently deleting ${ids.length} photos…`,
      );
      const res = await api.batchPurgeMedia(ids);
      const purged = new Set(res.purged_ids);
      setItems((prev) => prev.filter((item) => !purged.has(item.id)));
      setSelectedIds(new Set());
      setStatus(
        res.purged_count === 1
          ? "Permanently deleted 1 photo"
          : `Permanently deleted ${res.purged_count} photos`,
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to permanently delete",
      );
    }
  }

  return (
    <LibraryShell
      user={user}
      nav={isTrash ? "trash" : "photos"}
      contentLabel={isTrash ? "Trash" : "Photo timeline"}
      onLogout={onLogout}
      heading={
        <>
          {selectionActive || choosingAlbum ? (
            <div className="selection-heading">
              <button
                className="selection-clear"
                type="button"
                aria-label={
                  choosingAlbum ? "Cancel choosing album" : "Clear selection"
                }
                title={choosingAlbum ? "Cancel" : "Clear selection"}
                disabled={!!addingToAlbumId}
                onClick={choosingAlbum ? cancelChoosingAlbum : clearSelection}
              >
                <CloseIcon />
              </button>
              <h1 className="selection-count">
                {choosingAlbum
                  ? selectedCount === 1
                    ? "Add 1 photo to…"
                    : `Add ${selectedCount} photos to…`
                  : `${selectedCount} Selected`}
              </h1>
            </div>
          ) : (
            <h1 className="page-heading">{isTrash ? "Trash" : "Photos"}</h1>
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
        choosingAlbum ? null : (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,.heic,.heif"
              multiple
              hidden
              onChange={(e) => void onFilesSelected(e.target.files)}
            />
            {!isTrash && !selectionActive ? (
              <button
                className="icon-btn"
                type="button"
                aria-label={uploading ? "Uploading" : "Upload photos"}
                title={uploading ? "Uploading…" : "Upload photos"}
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                <UploadIcon />
              </button>
            ) : null}
            {selectionActive && !isTrash ? (
              <>
                <button
                  className="icon-btn"
                  type="button"
                  aria-label="Add selected photos to album"
                  title="Add to album"
                  disabled={!!addingToAlbumId}
                  onClick={() => void startChoosingAlbum()}
                >
                  <AddToAlbumIcon />
                </button>
                <button
                  className="icon-btn"
                  type="button"
                  aria-label="Move selected to Trash"
                  title="Move to Trash"
                  onClick={() => void onDeleteSelected()}
                >
                  <TrashIcon />
                </button>
              </>
            ) : null}
            {selectionActive && isTrash ? (
              <>
                <button
                  className="icon-btn"
                  type="button"
                  aria-label="Restore selected to Photos"
                  title="Restore"
                  onClick={() => void onRestoreSelected()}
                >
                  <RestoreIcon />
                </button>
                <button
                  className="icon-btn"
                  type="button"
                  aria-label="Permanently delete selected"
                  title="Delete forever"
                  onClick={() => void onPurgeSelected()}
                >
                  <TrashIcon />
                </button>
              </>
            ) : null}
          </>
        )
      }
    >
      {choosingAlbum ? (
        albumsLoading ? (
          <p className="muted content-status">Loading albums…</p>
        ) : albumChoices.length === 0 ? (
          <div className="empty">
            <h2>No albums yet</h2>
            <p className="muted">
              Create an album first, then you can add these photos to it.
            </p>
            <Link className="btn secondary" to="/albums">
              Go to Albums
            </Link>
          </div>
        ) : (
          <div className="albums-grid">
            {albumChoices.map((choice) => (
              <button
                className="album-tile album-tile-button"
                type="button"
                disabled={!!addingToAlbumId}
                aria-label={`Add selected photos to ${choice.title}`}
                onClick={() => void addSelectedToAlbum(choice)}
                key={choice.id}
              >
                <div className="album-cover">
                  {choice.cover_url ? (
                    <img src={choice.cover_url} alt="" />
                  ) : (
                    <div className="album-cover-empty" aria-hidden="true" />
                  )}
                </div>
                <h2 className="album-title">{choice.title}</h2>
                <p className="muted album-meta">
                  {choice.year}
                  {choice.media_count
                    ? ` · ${choice.media_count} item${
                        choice.media_count === 1 ? "" : "s"
                      }`
                    : ""}
                  {addingToAlbumId === choice.id ? " · Adding…" : ""}
                </p>
              </button>
            ))}
          </div>
        )
      ) : loading ? (
        <p className="muted content-status">
          {isTrash ? "Loading trash…" : "Loading timeline…"}
        </p>
      ) : items.length === 0 ? (
        <div className="empty">
          {isTrash ? (
            <>
              <h2>Trash is empty</h2>
              <p className="muted">
                Photos you move to Trash will show up here. You can restore them
                later.
              </p>
            </>
          ) : (
            <>
              <h2>No photos yet</h2>
              <p className="muted">
                Upload from your phone or computer. Files go straight to
                Cloudflare R2 and appear here in chronological order.
              </p>
              <button
                className="btn"
                type="button"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? "Uploading…" : "Upload photos"}
              </button>
            </>
          )}
        </div>
      ) : (
        <>
          <PhotoSections
            items={items}
            getDate={getDate}
            selectedIds={selectedIds}
            onSelectedIdsChange={setSelectedIds}
            canDelete={!isTrash}
            onDelete={
              isTrash
                ? undefined
                : async (id) => {
                    await onDelete(id, { skipConfirm: true });
                  }
            }
          />
          {nextCursor ? (
            <div className="load-more">
              <button
                className="btn secondary"
                type="button"
                onClick={() => void load(false)}
              >
                Load more
              </button>
            </div>
          ) : null}
        </>
      )}
    </LibraryShell>
  );
}
