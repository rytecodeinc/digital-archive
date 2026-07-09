import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Env } from "../types";

export function r2Client(env: Env) {
  return new S3Client({
    region: "auto",
    endpoint: `https://${env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
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

export async function presignPut(
  env: Env,
  key: string,
  contentType: string,
  _contentLength: number,
) {
  const client = r2Client(env);
  // Sign only Content-Type. Browsers set Content-Length automatically; including it
  // in SignedHeaders often causes signature mismatches from fetch().
  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(client, command, { expiresIn: 15 * 60 });
}

export async function putObject(
  env: Env,
  key: string,
  body: ArrayBuffer | Uint8Array,
  contentType: string,
) {
  const client = r2Client(env);
  await client.send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: key,
      Body: body instanceof Uint8Array ? body : new Uint8Array(body),
      ContentType: contentType,
    }),
  );
}

export async function headObject(env: Env, key: string) {
  const client = r2Client(env);
  return client.send(
    new HeadObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: key,
    }),
  );
}

export async function getObject(env: Env, key: string) {
  const client = r2Client(env);
  return client.send(
    new GetObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: key,
    }),
  );
}

export async function deleteObject(env: Env, key: string) {
  const client = r2Client(env);
  await client.send(
    new DeleteObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: key,
    }),
  );
}

export async function presignGet(env: Env, key: string, expiresIn = 3600) {
  const client = r2Client(env);
  const command = new GetObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: key,
  });
  return getSignedUrl(client, command, { expiresIn });
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
