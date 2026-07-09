import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type AlbumSummary, type User } from "../lib/api";
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

export function AlbumDetailPage({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => Promise<void>;
}) {
  const { albumId } = useParams<{ albumId: string }>();
  const [album, setAlbum] = useState<AlbumSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!albumId) {
      setError("Album not found");
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setAlbum(null);

    api
      .album(albumId)
      .then((res) => {
        if (!cancelled) setAlbum(res.album);
      })
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

  return (
    <LibraryShell
      user={user}
      nav="albums"
      contentLabel={album?.title || "Album"}
      onLogout={onLogout}
      heading={
        <>
          <h1 className="page-heading">
            {loading ? "Album" : album?.title || "Album"}
          </h1>
          {error ? (
            <p className="topbar-message is-error" role="alert">
              {error}
            </p>
          ) : null}
        </>
      }
      actions={
        <button
          className="icon-btn"
          type="button"
          aria-label="Add to album"
          title="Add to album"
          disabled={!album}
        >
          <PlusIcon />
        </button>
      }
    >
      {loading ? (
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
      ) : album.media_count === 0 ? (
        <div className="empty">
          <h2>No photos in this album</h2>
          <p className="muted">
            Photos you add to “{album.title}” will appear here.
          </p>
        </div>
      ) : (
        <div className="empty">
          <h2>{album.media_count} item{album.media_count === 1 ? "" : "s"}</h2>
          <p className="muted">Album contents will show here soon.</p>
        </div>
      )}
    </LibraryShell>
  );
}
