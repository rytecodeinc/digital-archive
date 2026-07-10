export type User = {
  id: string;
  email: string;
  display_name: string;
};

export type TimelineItem = {
  id: string;
  type: string;
  sort_at: string;
  taken_at: string | null;
  deleted_at?: string | null;
  width: number | null;
  height: number | null;
  caption: string | null;
  mime_type: string;
  thumb_url: string;
  preview_url: string;
};

export type AlbumSummary = {
  id: string;
  year: number;
  location_slug: string;
  title: string;
  description: string | null;
  visibility: string;
  media_count: number;
  photo_count: number;
  video_count: number;
  start_date: string | null;
  end_date: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  cover_url: string | null;
};

// Production Pages often cannot rely on Functions proxying /api; call the Worker
// directly. Override with VITE_API_BASE_URL at build time if needed.
const API_BASE = (
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.PROD ? "https://digital-archive.rytecode.workers.dev" : "")
).replace(/\/$/, "");

function apiUrl(path: string) {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${API_BASE}${path}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || res.statusText);
  }
  return data as T;
}

export const api = {
  me: () =>
    request<{ user: User; archive: { id: string; title: string } }>("/api/auth/me"),
  login: (email: string, password: string) =>
    request<{ user: User }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  timeline: (cursor?: string | null) => {
    const q = new URLSearchParams({ limit: "60" });
    if (cursor) q.set("cursor", cursor);
    return request<{ items: TimelineItem[]; next_cursor: string | null }>(
      `/api/owner/media/timeline?${q}`,
    );
  },
  trash: (cursor?: string | null) => {
    const q = new URLSearchParams({ limit: "60" });
    if (cursor) q.set("cursor", cursor);
    return request<{ items: TimelineItem[]; next_cursor: string | null }>(
      `/api/owner/media/trash?${q}`,
    );
  },
  createUploadSession: (body: {
    mime_type: string;
    byte_size: number;
    content_hash?: string;
    client_local_id?: string;
    taken_at?: string;
    width?: number;
    height?: number;
  }) =>
    request<{
      media_id?: string;
      upload_url?: string;
      proxy_upload_url?: string;
      upload_headers?: Record<string, string>;
      deduped?: boolean;
      status?: string;
      resumed?: boolean;
    }>("/api/owner/media/upload-sessions", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  uploadContent: async (proxyUrl: string, file: File, contentType: string) => {
    const res = await fetch(apiUrl(proxyUrl), {
      method: "PUT",
      credentials: "include",
      headers: {
        "Content-Type": contentType,
      },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Upload failed (${res.status})`);
    }
    return data as { media_id: string; status: string };
  },
  completeUpload: (id: string) =>
    request<{ media_id: string; status: string }>(
      `/api/owner/media/${id}/complete`,
      { method: "POST" },
    ),
  downloadMedia: (id: string) =>
    request<{ download_url: string; filename: string; mime_type: string }>(
      `/api/owner/media/${id}/download`,
    ),
  deleteMedia: (id: string) =>
    request<{ ok: boolean }>(`/api/owner/media/${id}`, { method: "DELETE" }),
  batchDeleteMedia: async (ids: string[]) => {
    try {
      return await request<{
        ok: boolean;
        deleted_count: number;
        deleted_ids: string[];
      }>("/api/owner/media/batch-delete", {
        method: "POST",
        body: JSON.stringify({ ids }),
      });
    } catch (err) {
      // Fall back to per-item soft-delete if the batch route isn't available yet.
      const message = err instanceof Error ? err.message : "";
      if (!/not found/i.test(message)) throw err;
      const deleted_ids: string[] = [];
      for (const id of ids) {
        await request<{ ok: boolean }>(`/api/owner/media/${id}`, {
          method: "DELETE",
        });
        deleted_ids.push(id);
      }
      return {
        ok: true,
        deleted_count: deleted_ids.length,
        deleted_ids,
      };
    }
  },
  batchPurgeMedia: (ids: string[]) =>
    request<{ ok: boolean; purged_count: number; purged_ids: string[] }>(
      "/api/owner/media/batch-purge",
      {
        method: "POST",
        body: JSON.stringify({ ids }),
      },
    ),
  batchRestoreMedia: (ids: string[]) =>
    request<{ ok: boolean; restored_count: number; restored_ids: string[] }>(
      "/api/owner/media/batch-restore",
      {
        method: "POST",
        body: JSON.stringify({ ids }),
      },
    ),
  albums: () => request<{ albums: AlbumSummary[] }>("/api/owner/albums"),
  createAlbum: (title: string) =>
    request<{ album: AlbumSummary }>("/api/owner/albums", {
      method: "POST",
      body: JSON.stringify({ title }),
    }),
  album: (id: string) =>
    request<{ album: AlbumSummary }>(`/api/owner/albums/${id}`),
  albumMedia: (id: string, cursor?: string | null) => {
    const q = new URLSearchParams({ limit: "100" });
    if (cursor) q.set("cursor", cursor);
    return request<{ items: TimelineItem[]; next_cursor: string | null }>(
      `/api/owner/albums/${id}/media?${q}`,
    );
  },
  addAlbumMedia: (id: string, mediaIds: string[]) =>
    request<{ ok: boolean; added_count: number; added_ids: string[] }>(
      `/api/owner/albums/${id}/media/batch-add`,
      {
        method: "POST",
        body: JSON.stringify({ media_ids: mediaIds }),
      },
    ),
  removeAlbumMedia: (id: string, mediaIds: string[]) =>
    request<{ ok: boolean; removed_count: number; removed_ids: string[] }>(
      `/api/owner/albums/${id}/media/batch-remove`,
      {
        method: "POST",
        body: JSON.stringify({ media_ids: mediaIds }),
      },
    ),
};

export async function sha256Hex(file: Blob) {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function readImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  if (!file.type.startsWith("image/") || file.type.includes("heic")) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}
