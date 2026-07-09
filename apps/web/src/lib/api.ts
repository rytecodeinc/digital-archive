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
  width: number | null;
  height: number | null;
  caption: string | null;
  mime_type: string;
  thumb_url: string;
  preview_url: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
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
    const res = await fetch(proxyUrl, {
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
