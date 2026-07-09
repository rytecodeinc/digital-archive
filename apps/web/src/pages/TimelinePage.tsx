import { useEffect, useRef, useState } from "react";
import {
  api,
  readImageDimensions,
  sha256Hex,
  type TimelineItem,
  type User,
} from "../lib/api";

export function TimelinePage({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => Promise<void>;
}) {
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load(initial = false) {
    setError(null);
    try {
      const res = await api.timeline(initial ? null : nextCursor);
      setItems((prev) => (initial ? res.items : [...prev, ...res.items]));
      setNextCursor(res.next_cursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load timeline");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onFilesSelected(fileList: FileList | null) {
    if (!fileList?.length) return;
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

        // Prefer same-origin proxy upload so browsers aren't blocked by R2 CORS.
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

  async function onDelete(id: string) {
    if (!confirm("Delete this photo from the archive?")) return;
    await api.deleteMedia(id);
    setItems((prev) => prev.filter((item) => item.id !== id));
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">Digital Archive</div>
        <div className="topbar-actions">
          <span className="muted">{user.email}</span>
          <button className="btn secondary" type="button" onClick={() => void onLogout()}>
            Sign out
          </button>
        </div>
      </header>

      <main className="main">
        <div className="toolbar">
          <div>
            <h1 style={{ margin: 0 }}>Timeline</h1>
            <p className="muted" style={{ margin: "0.25rem 0 0" }}>
              Newest first · photos only in v1
            </p>
          </div>
          <div className="topbar-actions">
            <input
              ref={fileRef}
              type="file"
              accept="image/*,.heic,.heif"
              multiple
              hidden
              onChange={(e) => void onFilesSelected(e.target.files)}
            />
            <button
              className="btn"
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? "Uploading…" : "Upload photos"}
            </button>
          </div>
        </div>

        {status ? <p className="status-line">{status}</p> : null}
        {error ? <p className="error">{error}</p> : null}

        {loading ? (
          <p className="muted">Loading timeline…</p>
        ) : items.length === 0 ? (
          <div className="empty">
            <h2>No photos yet</h2>
            <p className="muted">
              Upload from your phone or computer. Files go straight to Cloudflare
              R2 and appear here in chronological order.
            </p>
          </div>
        ) : (
          <>
            <div className="timeline-grid">
              {items.map((item, index) => (
                <div
                  className="tile"
                  key={item.id}
                  style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
                >
                  <img src={item.thumb_url} alt={item.caption || "Archive photo"} loading="lazy" />
                  <button
                    className="btn danger delete"
                    type="button"
                    onClick={() => void onDelete(item.id)}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
            {nextCursor ? (
              <div style={{ marginTop: "1.25rem", textAlign: "center" }}>
                <button className="btn secondary" type="button" onClick={() => void load(false)}>
                  Load more
                </button>
              </div>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
