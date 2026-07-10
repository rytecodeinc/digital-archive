import type { MediaInfo } from "../lib/api";

export function PhotoInfoPanel({
  open,
  info,
  loading,
  error,
  onClose,
}: {
  open: boolean;
  info: MediaInfo | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  return (
    <aside
      className={`photo-info-panel${open ? " is-open" : ""}`}
      aria-hidden={!open}
      aria-label="Photo info"
      onClick={(e) => e.stopPropagation()}
    >
      <header className="photo-info-header">
        <button
          className="photo-info-close"
          type="button"
          aria-label="Close info"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
        <h2 className="photo-info-title">Info</h2>
      </header>

      <div className="photo-info-body">
        {loading ? <p className="photo-info-status">Loading details…</p> : null}
        {error ? <p className="photo-info-error">{error}</p> : null}

        {!loading && !error && info ? (
          <>
            <div className="photo-info-description">
              {info.caption || info.description || (
                <span className="photo-info-placeholder">Add a description</span>
              )}
            </div>

            <h3 className="photo-info-section-label">Details</h3>
            <ul className="photo-info-list">
              {info.taken_at || info.uploaded_at ? (
                <li className="photo-info-row">
                  <span className="photo-info-icon" aria-hidden="true">
                    <CalendarIcon />
                  </span>
                  <div className="photo-info-text">
                    <div className="photo-info-primary">
                      {formatDatePrimary(info.taken_at || info.uploaded_at)}
                    </div>
                    <div className="photo-info-secondary">
                      {formatDateSecondary(
                        info.taken_at || info.uploaded_at,
                        info.timezone,
                      )}
                    </div>
                  </div>
                </li>
              ) : null}

              {info.camera_name || info.specs_line ? (
                <li className="photo-info-row">
                  <span className="photo-info-icon" aria-hidden="true">
                    <CameraIcon />
                  </span>
                  <div className="photo-info-text">
                    {info.camera_name ? (
                      <div className="photo-info-primary">{info.camera_name}</div>
                    ) : null}
                    {info.specs_line ? (
                      <div className="photo-info-secondary">{info.specs_line}</div>
                    ) : null}
                  </div>
                </li>
              ) : null}

              {info.filename || info.dimensions_label ? (
                <li className="photo-info-row">
                  <span className="photo-info-icon" aria-hidden="true">
                    <ImageIcon />
                  </span>
                  <div className="photo-info-text">
                    {info.filename ? (
                      <div className="photo-info-primary">{info.filename}</div>
                    ) : null}
                    {info.dimensions_label ? (
                      <div className="photo-info-secondary">
                        {info.dimensions_label}
                      </div>
                    ) : null}
                  </div>
                </li>
              ) : null}

              {info.upload_source ? (
                <li className="photo-info-row">
                  <span className="photo-info-icon" aria-hidden="true">
                    <UploadIcon />
                  </span>
                  <div className="photo-info-text">
                    <div className="photo-info-primary">{info.upload_source}</div>
                  </div>
                </li>
              ) : null}

              {info.size_label ? (
                <li className="photo-info-row">
                  <span className="photo-info-icon" aria-hidden="true">
                    <CloudIcon />
                  </span>
                  <div className="photo-info-text">
                    <div className="photo-info-primary">
                      Backed up ({info.size_label})
                    </div>
                    <div className="photo-info-secondary">Original quality</div>
                  </div>
                </li>
              ) : null}

              {info.location_name ||
              (info.latitude != null && info.longitude != null) ? (
                <li className="photo-info-row">
                  <span className="photo-info-icon" aria-hidden="true">
                    <PinIcon />
                  </span>
                  <div className="photo-info-text">
                    <div className="photo-info-primary">
                      {info.location_name ||
                        `${info.latitude!.toFixed(5)}, ${info.longitude!.toFixed(5)}`}
                    </div>
                    {info.location_name &&
                    info.latitude != null &&
                    info.longitude != null ? (
                      <div className="photo-info-secondary">
                        {info.latitude.toFixed(5)}, {info.longitude.toFixed(5)}
                      </div>
                    ) : null}
                  </div>
                </li>
              ) : null}
            </ul>
          </>
        ) : null}
      </div>
    </aside>
  );
}

function formatDatePrimary(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDateSecondary(iso: string, timezone: string | null) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const weekday = d.toLocaleDateString(undefined, { weekday: "short" });
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const tz =
    timezone ||
    (() => {
      try {
        const parts = new Intl.DateTimeFormat(undefined, {
          timeZoneName: "shortOffset",
        }).formatToParts(d);
        return parts.find((p) => p.type === "timeZoneName")?.value || "";
      } catch {
        return "";
      }
    })();
  return [weekday, time, tz].filter(Boolean).join(", ");
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M18.3 5.71 12 12.01 5.7 5.7 4.29 7.11 10.59 13.4 4.29 19.7 5.7 21.11 12 14.82 18.29 21.11 19.7 19.7 13.41 13.4 19.71 7.11z"
      />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2z"
      />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 15.2A3.2 3.2 0 1 0 12 8.8a3.2 3.2 0 0 0 0 6.4zm8-9.2h-3.2l-1.8-2H9L7.2 6H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 14H4V8h4.05l1.83-2h4.24l1.83 2H20v12z"
      />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"
      />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z"
      />
    </svg>
  );
}

function CloudIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM10 17l-3.5-3.5 1.41-1.41L10 14.17l4.59-4.59L16 11l-6 6z"
      />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"
      />
    </svg>
  );
}
