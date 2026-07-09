import { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  readImageDimensions,
  sha256Hex,
  type TimelineItem,
  type User,
} from "../lib/api";
import { groupTimelineByDay } from "../lib/timelineGroups";
import { JustifiedDayGrid } from "../components/JustifiedDayGrid";
import { LibraryShell } from "../components/LibraryShell";
import { Lightbox } from "../components/Lightbox";

export type LibraryView = "photos" | "trash";

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
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [hoveredSectionKey, setHoveredSectionKey] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const dayGroups = useMemo(
    () =>
      groupTimelineByDay(items, new Date(), (item) =>
        isTrash
          ? item.deleted_at || item.taken_at || item.sort_at
          : item.taken_at || item.sort_at,
      ),
    [items, isTrash],
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
    setLightboxIndex(null);
    setSelectedIds(new Set());
    setHoveredSectionKey(null);
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  function clearSelection() {
    setSelectedIds(new Set());
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
    setItems((prev) => {
      const next = prev.filter((item) => item.id !== id);
      setLightboxIndex((current) => {
        if (current === null) return null;
        if (!next.length) return null;
        return Math.min(current, next.length - 1);
      });
      return next;
    });
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
      setLightboxIndex(null);
      setStatus(
        res.deleted_count === 1
          ? "Moved 1 photo to Trash"
          : `Moved ${res.deleted_count} photos to Trash`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to move to Trash");
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
      setLightboxIndex(null);
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
    <>
      <LibraryShell
        user={user}
        nav={isTrash ? "trash" : "photos"}
        contentLabel={isTrash ? "Trash" : "Photo timeline"}
        onLogout={onLogout}
        heading={
          <>
            {selectionActive ? (
              <div className="selection-heading">
                <button
                  className="selection-clear"
                  type="button"
                  aria-label="Clear selection"
                  title="Clear selection"
                  onClick={clearSelection}
                >
                  <CloseIcon />
                </button>
                <h1 className="selection-count">{selectedCount} Selected</h1>
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
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,.heic,.heif"
              multiple
              hidden
              onChange={(e) => void onFilesSelected(e.target.files)}
            />
            {!isTrash ? (
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
              <button
                className="icon-btn"
                type="button"
                aria-label="Move selected to Trash"
                title="Move to Trash"
                onClick={() => void onDeleteSelected()}
              >
                <TrashIcon />
              </button>
            ) : null}
            {selectionActive && isTrash ? (
              <button
                className="icon-btn"
                type="button"
                aria-label="Permanently delete selected"
                title="Delete forever"
                onClick={() => void onPurgeSelected()}
              >
                <TrashIcon />
              </button>
            ) : null}
          </>
        }
      >
        {loading ? (
          <p className="muted content-status">
            {isTrash ? "Loading trash…" : "Loading timeline…"}
          </p>
        ) : items.length === 0 ? (
          <div className="empty">
            {isTrash ? (
              <>
                <h2>Trash is empty</h2>
                <p className="muted">
                  Photos you move to Trash will show up here. You can restore
                  them later.
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
                      selectionActive={selectionActive}
                      onToggleSelect={toggleSelect}
                      onOpen={(item) => {
                        const idx = items.findIndex((entry) => entry.id === item.id);
                        if (idx >= 0) setLightboxIndex(idx);
                      }}
                    />
                  </section>
                );
              })}
            </div>
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

      {lightboxIndex !== null ? (
        <Lightbox
          items={items}
          index={lightboxIndex}
          canDelete={!isTrash}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
          onDelete={async (id) => {
            await onDelete(id, { skipConfirm: true });
          }}
        />
      ) : null}
    </>
  );
}
