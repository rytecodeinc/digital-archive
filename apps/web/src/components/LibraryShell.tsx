import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api, type StorageUsage, type User } from "../lib/api";

export type LibraryNav = "photos" | "albums" | "trash";

function PhotosIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-4.86 8.86-3 3.87L9 13.14 6 17h12l-3.86-5.14z"
      />
    </svg>
  );
}

function AlbumsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 18H6V4h5v7l2.5-1.5L16 11V4h2v16z"
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

function StorageIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M2 20h20v-4H2v4zm2-3h2v2H4v-2zM2 4v4h20V4H2zm4 3H4V5h2v2zm-4 7h20v-4H2v4zm2-3h2v2H4v-2z"
      />
    </svg>
  );
}

function formatGb(value: number) {
  if (value < 0.01) return "0 GB";
  if (value < 1) return `${value.toFixed(2)} GB`;
  if (value < 10) return `${value.toFixed(1)} GB`;
  return `${Math.round(value)} GB`;
}

function StorageMeter() {
  const [storage, setStorage] = useState<StorageUsage | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .storage()
      .then((res) => {
        if (!cancelled) setStorage(res);
      })
      .catch(() => {
        if (!cancelled) setStorage(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!storage) return null;

  const percent = Math.max(0, Math.min(100, storage.percent));
  const label = `${formatGb(storage.used_gb)} of ${formatGb(storage.quota_gb)} used`;

  return (
    <div className="storage-meter" title={label} aria-label={label}>
      <div className="storage-meter-head">
        <StorageIcon />
        <span className="storage-meter-label">Storage</span>
      </div>
      <div
        className="storage-meter-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        aria-valuetext={label}
      >
        <div className="storage-meter-fill" style={{ width: `${percent}%` }} />
      </div>
      <p className="storage-meter-text">{label}</p>
    </div>
  );
}

export function LibraryShell({
  user,
  nav,
  heading,
  actions,
  contentLabel,
  onLogout,
  children,
}: {
  user: User;
  nav: LibraryNav;
  heading: ReactNode;
  actions?: ReactNode;
  contentLabel: string;
  onLogout: () => Promise<void>;
  children: ReactNode;
}) {
  const initials = user.display_name?.slice(0, 1).toUpperCase() || "R";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <div className="brand-mark" aria-hidden="true">
            <PhotosIcon />
          </div>
          <div className="brand">Digital Archive</div>
        </div>
        <div className="topbar-center">{heading}</div>
        <div className="topbar-actions">
          {actions}
          <button
            className="avatar-btn"
            type="button"
            title={`${user.email} · Sign out`}
            aria-label="Sign out"
            onClick={() => void onLogout()}
          >
            {initials}
          </button>
        </div>
      </header>

      <div className="shell-body">
        <aside className="sidebar" aria-label="Library">
          <nav className="sidebar-nav">
            <Link
              className={`sidebar-link${nav === "photos" ? " is-active" : ""}`}
              to="/photos"
              aria-current={nav === "photos" ? "page" : undefined}
            >
              <PhotosIcon />
              <span>Photos</span>
            </Link>
            <Link
              className={`sidebar-link${nav === "albums" ? " is-active" : ""}`}
              to="/albums"
              aria-current={nav === "albums" ? "page" : undefined}
            >
              <AlbumsIcon />
              <span>Albums</span>
            </Link>
          </nav>
          <div className="sidebar-footer">
            <StorageMeter />
            <nav aria-label="Trash">
              <Link
                className={`sidebar-link${nav === "trash" ? " is-active" : ""}`}
                to="/trash"
                aria-current={nav === "trash" ? "page" : undefined}
              >
                <TrashIcon />
                <span>Trash</span>
              </Link>
            </nav>
          </div>
        </aside>

        <section className="content-frame" aria-label={contentLabel}>
          <div className="content-scroll">{children}</div>
        </section>
      </div>
    </div>
  );
}
