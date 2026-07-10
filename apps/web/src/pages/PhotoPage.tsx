import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Lightbox } from "../components/Lightbox";
import { api, type TimelineItem, type User } from "../lib/api";

export function PhotoPage({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => Promise<void>;
}) {
  const { publicId = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const from =
    (location.state as { from?: string } | null)?.from ||
    "/photos";
  const [item, setItem] = useState<TimelineItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setItem(null);

    api
      .mediaByPublicId(publicId)
      .then((res) => {
        if (!cancelled) setItem(res.item);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Photo not found");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [publicId]);

  if (loading) {
    return (
      <div className="login-page">
        <p className="muted">Loading photo…</p>
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="login-page">
        <p className="error">{error || "Photo not found"}</p>
        <p className="muted">Signed in as {user.email}</p>
        <div className="topbar-actions" style={{ justifyContent: "center" }}>
          <Link className="btn" to="/photos">
            Back to Photos
          </Link>
          <button className="btn secondary" type="button" onClick={() => void onLogout()}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  const inTrash = Boolean(item.deleted_at);

  return (
    <Lightbox
      items={[item]}
      index={0}
      canDelete={!inTrash}
      onClose={() => navigate(from)}
      onNavigate={() => undefined}
      onDelete={async (id) => {
        await api.deleteMedia(id);
        navigate(from === "/trash" ? "/photos" : from);
      }}
    />
  );
}
