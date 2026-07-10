export type HyperdriveBinding = {
  connectionString: string;
};

export type Env = {
  /** Optional when Hyperdrive is bound; still used for local Node API. */
  DATABASE_URL?: string;
  /** Preferred on Cloudflare Workers — bind in dashboard or wrangler.toml. */
  HYPERDRIVE?: HyperdriveBinding;
  /** Native R2 binding — preferred in production (no access-key secrets). */
  MEDIA_BUCKET?: R2Bucket;
  R2_BUCKET: string;
  CF_ACCOUNT_ID: string;
  /** Optional; only needed for local Node API / direct S3 presigns. */
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  SESSION_SECRET: string;
  OWNER_EMAIL: string;
  /** Soft quota shown in the sidebar storage meter (default 15). */
  STORAGE_QUOTA_GB?: string;
};

export type UserRow = {
  id: string;
  email: string;
  display_name: string;
  password_hash: string | null;
};

export type ArchiveRow = {
  id: string;
  owner_user_id: string;
  title: string;
};

export type MediaRow = {
  id: string;
  archive_id: string;
  type: "photo" | "video";
  status: string;
  sort_at: string;
  mime_type: string;
  width: number | null;
  height: number | null;
  byte_size: number | null;
  caption: string | null;
  r2_original_key: string;
  r2_thumb_key: string | null;
  r2_preview_key: string | null;
  taken_at: string | null;
  uploaded_at: string;
};
