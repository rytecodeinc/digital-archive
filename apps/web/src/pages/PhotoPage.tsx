import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Lightbox } from "../components/Lightbox";
import type { PhotoRouteState } from "../components/PhotoSections";
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
  const routeState = (location.state as PhotoRouteState | null) || null;
  const from = routeState?.from || "/photos";
  const canDelete = routeState?.canDelete ?? true;

  const [fetchedItem, setFetchedItem] = useState<TimelineItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!routeState?.items?.length);

  const items = useMemo(() => {
    if (routeState?.items?.length) return routeState.items;
    return fetchedItem ? [fetchedItem] : [];
  }, [routeState?.items, fetchedItem]);

  const index = useMemo(() => {
    const idx = items.findIndex((item) => item.public_id === publicId);
    return idx >= 0 ? idx : 0;
  }, [items, publicId]);

  useEffect(() => {
    // Prefer the gallery list passed via navigation state so prev/next works.
    if (routeState?.items?.length) {
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setFetchedItem(null);

    api
      .mediaByPublicId(publicId)
      .then((res) => {
        if (!cancelled) setFetchedItem(res.item);
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
  }, [publicId, routeState?.items]);

  function goToIndex(nextIndex: number) {
    const next = items[nextIndex];
    if (!next?.public_id) return;
    navigate(`/photo/${next.public_id}`, {
      replace: true,
      state: {
        from,
        items,
        canDelete,
      } satisfies PhotoRouteState,
    });
  }

  if (loading) {
    return (
      <div className="login-page">
        <p className="muted">Loading photo…</p>
      </div>
    );
  }

  if (error || !items.length || !items[index]) {
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

  const current = items[index];
  const inTrash = Boolean(current.deleted_at);

  return (
    <Lightbox
      items={items}
      index={index}
      canDelete={canDelete && !inTrash}
      onClose={() => navigate(from)}
      onNavigate={goToIndex}
      onDelete={async (id) => {
        await api.deleteMedia(id);
        const nextItems = items.filter((item) => item.id !== id);
        if (!nextItems.length) {
          navigate(from === "/trash" ? "/photos" : from);
          return;
        }
        const nextIndex = Math.min(index, nextItems.length - 1);
        const next = nextItems[nextIndex];
        navigate(`/photo/${next.public_id}`, {
          replace: true,
          state: {
            from,
            items: nextItems,
            canDelete,
          } satisfies PhotoRouteState,
        });
      }}
    />
  );
}
