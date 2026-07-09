import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, type AlbumSummary, type User } from "../lib/api";
import { LibraryShell } from "../components/LibraryShell";

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

export function AlbumsPage({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => Promise<void>;
}) {
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [albumName, setAlbumName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .albums()
      .then((res) => {
        if (!cancelled) setAlbums(res.albums);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load albums");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!createOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    nameInputRef.current?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !creating) closeCreateModal();
    }

    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [createOpen, creating]);

  function openCreateModal() {
    setAlbumName("");
    setCreateError(null);
    setCreateOpen(true);
  }

  function closeCreateModal() {
    if (creating) return;
    setCreateOpen(false);
    setAlbumName("");
    setCreateError(null);
  }

  async function onCreateAlbum(e: FormEvent) {
    e.preventDefault();
    const title = albumName.trim();
    if (!title) {
      setCreateError("Enter an album name");
      return;
    }

    setCreating(true);
    setCreateError(null);
    setError(null);
    try {
      const res = await api.createAlbum(title);
      setAlbums((prev) => [res.album, ...prev]);
      setStatus(`Created “${res.album.title}”`);
      setCreateOpen(false);
      setAlbumName("");
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create album");
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <LibraryShell
        user={user}
        nav="albums"
        contentLabel="Albums"
        onLogout={onLogout}
        heading={
          <>
            <h1 className="page-heading">Albums</h1>
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
          <button
            className="icon-btn"
            type="button"
            aria-label="Create album"
            title="Create album"
            onClick={openCreateModal}
          >
            <UploadIcon />
          </button>
        }
      >
        {loading ? (
          <p className="muted content-status">Loading albums…</p>
        ) : albums.length === 0 ? (
          <div className="empty">
            <h2>No albums yet</h2>
            <p className="muted">
              Curated travel albums will appear here. Create an album to group
              photos from a trip without copying files.
            </p>
            <button className="btn" type="button" onClick={openCreateModal}>
              Create album
            </button>
          </div>
        ) : (
          <div className="albums-grid">
            {albums.map((album) => (
              <article className="album-tile" key={album.id}>
                <div className="album-cover">
                  {album.cover_url ? (
                    <img src={album.cover_url} alt="" />
                  ) : (
                    <div className="album-cover-empty" aria-hidden="true" />
                  )}
                </div>
                <h2 className="album-title">{album.title}</h2>
                <p className="muted album-meta">
                  {album.year}
                  {album.media_count
                    ? ` · ${album.media_count} item${album.media_count === 1 ? "" : "s"}`
                    : ""}
                </p>
              </article>
            ))}
          </div>
        )}
      </LibraryShell>

      {createOpen ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={closeCreateModal}
        >
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-album-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="create-album-title">Create album</h2>
            <p className="muted">Give your album a name. You can add photos later.</p>
            <form className="modal-form" onSubmit={(e) => void onCreateAlbum(e)}>
              <label htmlFor="album-name">Album name</label>
              <input
                ref={nameInputRef}
                id="album-name"
                type="text"
                value={albumName}
                onChange={(e) => setAlbumName(e.target.value)}
                placeholder="e.g. Malaysia 2026"
                maxLength={120}
                autoComplete="off"
                disabled={creating}
                required
              />
              {createError ? (
                <p className="error" role="alert">
                  {createError}
                </p>
              ) : null}
              <div className="modal-actions">
                <button
                  className="btn secondary"
                  type="button"
                  disabled={creating}
                  onClick={closeCreateModal}
                >
                  Cancel
                </button>
                <button className="btn" type="submit" disabled={creating}>
                  {creating ? "Creating…" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
