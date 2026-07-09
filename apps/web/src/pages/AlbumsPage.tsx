import { useEffect, useState } from "react";
import { api, type AlbumSummary, type User } from "../lib/api";
import { LibraryShell } from "../components/LibraryShell";

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

  return (
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
          ) : null}
        </>
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
  );
}
