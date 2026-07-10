import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Env } from "../types";

type R2ObjectLike = {
  Body?: {
    transformToByteArray(): Promise<Uint8Array>;
  } | null;
  ContentLength?: number;
  ContentType?: string | null;
};

function hasS3Credentials(env: Env) {
  return Boolean(env.R2_ACCESS_KEY_ID?.trim() && env.R2_SECRET_ACCESS_KEY?.trim());
}

function hasBucketBinding(env: Env) {
  return Boolean(env.MEDIA_BUCKET);
}

export function r2Client(env: Env) {
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "Missing R2 credentials: set Worker secrets R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY (local/dev), or bind MEDIA_BUCKET in wrangler.toml",
    );
  }
  return new S3Client({
    region: "auto",
    endpoint: `https://${env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    // Prevent AWS SDK v3 from injecting checksum query params that browsers omit.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

export function originalKey(archiveId: string, mediaId: string, ext: string) {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `originals/${archiveId}/${yyyy}/${mm}/${mediaId}/original.${ext}`;
}

/** Same-origin URL for authenticated media viewing (no S3 presign / CORS). */
export function mediaContentUrl(mediaId: string, opts?: { download?: boolean }) {
  const q = opts?.download ? "?download=1" : "";
  return `/api/owner/media/${mediaId}/content${q}`;
}

export async function putObject(
  env: Env,
  key: string,
  body: ArrayBuffer | Uint8Array,
  contentType: string,
) {
  const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
  if (hasBucketBinding(env)) {
    await env.MEDIA_BUCKET!.put(key, bytes, {
      httpMetadata: { contentType },
    });
    return;
  }
  const client = r2Client(env);
  await client.send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: key,
      Body: bytes,
      ContentType: contentType,
    }),
  );
}

export async function headObject(env: Env, key: string) {
  if (hasBucketBinding(env)) {
    const obj = await env.MEDIA_BUCKET!.head(key);
    if (!obj) throw new Error("object missing");
    return { ContentLength: obj.size, ContentType: obj.httpMetadata?.contentType };
  }
  const client = r2Client(env);
  return client.send(
    new HeadObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: key,
    }),
  );
}

export async function getObject(env: Env, key: string): Promise<R2ObjectLike> {
  if (hasBucketBinding(env)) {
    const obj = await env.MEDIA_BUCKET!.get(key);
    if (!obj) return { Body: null };
    return {
      ContentLength: obj.size,
      ContentType: obj.httpMetadata?.contentType ?? null,
      Body: {
        transformToByteArray: async () => new Uint8Array(await obj.arrayBuffer()),
      },
    };
  }
  const client = r2Client(env);
  return client.send(
    new GetObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: key,
    }),
  );
}

export async function deleteObject(env: Env, key: string) {
  if (hasBucketBinding(env)) {
    await env.MEDIA_BUCKET!.delete(key);
    return;
  }
  const client = r2Client(env);
  await client.send(
    new DeleteObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: key,
    }),
  );
}

/** Optional: direct-to-R2 upload URL when S3 credentials are present. */
export async function presignPut(
  env: Env,
  key: string,
  contentType: string,
  _contentLength: number,
) {
  if (!hasS3Credentials(env)) {
    throw new Error(
      "Direct R2 upload URLs require R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY; use proxy upload instead",
    );
  }
  const client = r2Client(env);
  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(client, command, { expiresIn: 15 * 60 });
}

export function extFromMime(mime: string) {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/heic":
    case "image/heif":
      return "heic";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}

export const ALLOWED_PHOTO_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/gif",
]);
