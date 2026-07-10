import { Hono } from "hono";
import type { Env } from "../types";
import { requireOwner } from "../lib/auth";
import { sql } from "../lib/db";
import {
  ALLOWED_PHOTO_MIME,
  deleteObject,
  extFromMime,
  getObject,
  headObject,
  originalKey,
  presignGet,
  presignPut,
  putObject,
} from "../lib/r2";

export const mediaRoutes = new Hono<{ Bindings: Env }>();

function hexToBytes(hex: string) {
  const clean = hex.replace(/^0x/, "").toLowerCase();
  if (clean.length % 2 !== 0 || !/^[0-9a-f]+$/.test(clean)) {
    throw new Error("invalid hex");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    out[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return out;
}

mediaRoutes.post("/upload-sessions", async (c) => {
  const owner = await requireOwner(c);
  if (owner instanceof Response) return owner;

  const body = await c.req.json<{
    mime_type?: string;
    byte_size?: number;
    content_hash?: string;
    client_local_id?: string;
    taken_at?: string;
    width?: number;
    height?: number;
  }>();

  const mime = body.mime_type?.toLowerCase();
  const byteSize = body.byte_size;

  if (!mime || !ALLOWED_PHOTO_MIME.has(mime)) {
    return c.json(
      {
        error: "unsupported mime_type",
        allowed: [...ALLOWED_PHOTO_MIME],
      },
      400,
    );
  }
  if (!byteSize || byteSize <= 0 || byteSize > 50 * 1024 * 1024) {
    return c.json({ error: "byte_size must be 1..50MB" }, 400);
  }

  if (body.content_hash) {
    try {
      const hashBytes = hexToBytes(body.content_hash);
      const existing = await sql(c.env)`
        select id, status from media
        where archive_id = ${owner.archive.id}
          and content_hash = ${hashBytes}
          and deleted_at is null
          and status in ('ready', 'processing', 'pending_upload')
        order by case status when 'ready' then 0 when 'processing' then 1 else 2 end
        limit 1
      `;
      if (existing.length && existing[0].status === "ready") {
        return c.json({
          deduped: true,
          media_id: existing[0].id,
          status: existing[0].status,
        });
      }
      if (existing.length && existing[0].status === "pending_upload") {
        // Resume an unfinished upload for the same bytes.
        const pending = await sql(c.env)`
          select id, r2_original_key, mime_type, byte_size
          from media where id = ${existing[0].id as string} limit 1
        `;
        const row = pending[0] as {
          id: string;
          r2_original_key: string;
          mime_type: string;
          byte_size: number;
        };
        const uploadUrl = await presignPut(
          c.env,
          row.r2_original_key,
          row.mime_type,
          Number(row.byte_size),
        );
        return c.json({
          media_id: row.id,
          upload_url: uploadUrl,
          // Same-origin proxy avoids browser→R2 CORS issues until bucket CORS is configured.
          proxy_upload_url: `/api/owner/media/${row.id}/content`,
          upload_headers: {
            "Content-Type": row.mime_type,
          },
          r2_key: row.r2_original_key,
          expires_in: 900,
          resumed: true,
        });
      }
    } catch {
      return c.json({ error: "content_hash must be hex sha256" }, 400);
    }
  }

  const mediaId = crypto.randomUUID();
  const ext = extFromMime(mime);
  const key = originalKey(owner.archive.id, mediaId, ext);
  const takenAt = body.taken_at ? new Date(body.taken_at) : null;
  if (takenAt && Number.isNaN(takenAt.getTime())) {
    return c.json({ error: "invalid taken_at" }, 400);
  }
  const sortAt = (takenAt ?? new Date()).toISOString();
  const contentHash = body.content_hash ? hexToBytes(body.content_hash) : null;

  await sql(c.env)`
    insert into media (
      id, archive_id, uploaded_by, type, status,
      taken_at, taken_at_source, sort_at,
      content_hash, byte_size, mime_type, width, height,
      r2_original_key, client_local_id
    ) values (
      ${mediaId},
      ${owner.archive.id},
      ${owner.user.id},
      'photo',
      'pending_upload',
      ${takenAt ? takenAt.toISOString() : null},
      ${takenAt ? "client" : "upload"},
      ${sortAt},
      ${contentHash},
      ${byteSize},
      ${mime},
      ${body.width ?? null},
      ${body.height ?? null},
      ${key},
      ${body.client_local_id ?? null}
    )
  `;

  const uploadUrl = await presignPut(c.env, key, mime, byteSize);

  return c.json({
    media_id: mediaId,
    upload_url: uploadUrl,
    proxy_upload_url: `/api/owner/media/${mediaId}/content`,
    upload_headers: {
      "Content-Type": mime,
    },
    r2_key: key,
    expires_in: 900,
  });
});

mediaRoutes.post("/upload-sessions/batch", async (c) => {
  const owner = await requireOwner(c);
  if (owner instanceof Response) return owner;

  const body = await c.req.json<{
    items?: Array<{
      mime_type?: string;
      byte_size?: number;
      content_hash?: string;
      client_local_id?: string;
      taken_at?: string;
      width?: number;
      height?: number;
    }>;
  }>();

  const items = body.items ?? [];
  if (!items.length || items.length > 50) {
    return c.json({ error: "items must be 1..50" }, 400);
  }

  const results = [];
  for (const item of items) {
    const mime = item.mime_type?.toLowerCase();
    const byteSize = item.byte_size;
    if (!mime || !ALLOWED_PHOTO_MIME.has(mime)) {
      results.push({ error: "unsupported mime_type", client_local_id: item.client_local_id });
      continue;
    }
    if (!byteSize || byteSize <= 0 || byteSize > 50 * 1024 * 1024) {
      results.push({ error: "invalid byte_size", client_local_id: item.client_local_id });
      continue;
    }

    if (item.content_hash) {
      try {
        const hashBytes = hexToBytes(item.content_hash);
        const existing = await sql(c.env)`
          select id, status from media
          where archive_id = ${owner.archive.id}
            and content_hash = ${hashBytes}
            and deleted_at is null
            and status = 'ready'
          limit 1
        `;
        if (existing.length) {
          results.push({
            deduped: true,
            media_id: existing[0].id,
            status: existing[0].status,
            client_local_id: item.client_local_id,
          });
          continue;
        }
      } catch {
        results.push({ error: "invalid content_hash", client_local_id: item.client_local_id });
        continue;
      }
    }

    const mediaId = crypto.randomUUID();
    const ext = extFromMime(mime);
    const key = originalKey(owner.archive.id, mediaId, ext);
    const takenAt = item.taken_at ? new Date(item.taken_at) : null;
    const sortAt = (takenAt && !Number.isNaN(takenAt.getTime()) ? takenAt : new Date()).toISOString();
    const contentHash = item.content_hash ? hexToBytes(item.content_hash) : null;

    await sql(c.env)`
      insert into media (
        id, archive_id, uploaded_by, type, status,
        taken_at, taken_at_source, sort_at,
        content_hash, byte_size, mime_type, width, height,
        r2_original_key, client_local_id
      ) values (
        ${mediaId},
        ${owner.archive.id},
        ${owner.user.id},
        'photo',
        'pending_upload',
        ${takenAt && !Number.isNaN(takenAt.getTime()) ? takenAt.toISOString() : null},
        ${takenAt && !Number.isNaN(takenAt.getTime()) ? "client" : "upload"},
        ${sortAt},
        ${contentHash},
        ${byteSize},
        ${mime},
        ${item.width ?? null},
        ${item.height ?? null},
        ${key},
        ${item.client_local_id ?? null}
      )
    `;

    const uploadUrl = await presignPut(c.env, key, mime, byteSize);
    results.push({
      media_id: mediaId,
      upload_url: uploadUrl,
      proxy_upload_url: `/api/owner/media/${mediaId}/content`,
      upload_headers: {
        "Content-Type": mime,
      },
      client_local_id: item.client_local_id,
      expires_in: 900,
    });
  }

  return c.json({ results });
});

mediaRoutes.get("/timeline", async (c) => {
  const owner = await requireOwner(c);
  if (owner instanceof Response) return owner;

  const limit = Math.min(Number(c.req.query("limit") || 50), 100);
  const cursor = c.req.query("cursor"); // sort_at|id

  let rows;
  if (cursor) {
    const [sortAt, id] = cursor.split("|");
    rows = await sql(c.env)`
      select id, type, status, sort_at, mime_type, width, height, byte_size,
             caption, r2_original_key, r2_thumb_key, r2_preview_key, taken_at, uploaded_at
      from media
      where archive_id = ${owner.archive.id}
        and deleted_at is null
        and status = 'ready'
        and (sort_at, id) < (${sortAt}::timestamptz, ${id}::uuid)
      order by sort_at desc, id desc
      limit ${limit}
    `;
  } else {
    rows = await sql(c.env)`
      select id, type, status, sort_at, mime_type, width, height, byte_size,
             caption, r2_original_key, r2_thumb_key, r2_preview_key, taken_at, uploaded_at
      from media
      where archive_id = ${owner.archive.id}
        and deleted_at is null
        and status = 'ready'
      order by sort_at desc, id desc
      limit ${limit}
    `;
  }

  const items = await Promise.all(
    rows.map(async (row) => {
      const key = (row.r2_thumb_key || row.r2_preview_key || row.r2_original_key) as string;
      const thumbUrl = await presignGet(c.env, key, 3600);
      return {
        id: row.id,
        type: row.type,
        sort_at: row.sort_at,
        taken_at: row.taken_at,
        width: row.width,
        height: row.height,
        caption: row.caption,
        mime_type: row.mime_type,
        thumb_url: thumbUrl,
        preview_url: thumbUrl,
      };
    }),
  );

  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === limit && last
      ? `${new Date(last.sort_at as string).toISOString()}|${last.id}`
      : null;

  return c.json({ items, next_cursor: nextCursor });
});

mediaRoutes.get("/trash", async (c) => {
  const owner = await requireOwner(c);
  if (owner instanceof Response) return owner;

  const limit = Math.min(Number(c.req.query("limit") || 50), 100);
  const cursor = c.req.query("cursor"); // deleted_at|id

  let rows;
  if (cursor) {
    const [deletedAt, id] = cursor.split("|");
    rows = await sql(c.env)`
      select id, type, status, sort_at, mime_type, width, height, byte_size,
             caption, r2_original_key, r2_thumb_key, r2_preview_key, taken_at,
             uploaded_at, deleted_at
      from media
      where archive_id = ${owner.archive.id}
        and deleted_at is not null
        and (deleted_at, id) < (${deletedAt}::timestamptz, ${id}::uuid)
      order by deleted_at desc, id desc
      limit ${limit}
    `;
  } else {
    rows = await sql(c.env)`
      select id, type, status, sort_at, mime_type, width, height, byte_size,
             caption, r2_original_key, r2_thumb_key, r2_preview_key, taken_at,
             uploaded_at, deleted_at
      from media
      where archive_id = ${owner.archive.id}
        and deleted_at is not null
      order by deleted_at desc, id desc
      limit ${limit}
    `;
  }

  const items = await Promise.all(
    rows.map(async (row) => {
      const key = (row.r2_thumb_key || row.r2_preview_key || row.r2_original_key) as string;
      const thumbUrl = await presignGet(c.env, key, 3600);
      return {
        id: row.id,
        type: row.type,
        sort_at: row.sort_at,
        taken_at: row.taken_at,
        deleted_at: row.deleted_at,
        width: row.width,
        height: row.height,
        caption: row.caption,
        mime_type: row.mime_type,
        thumb_url: thumbUrl,
        preview_url: thumbUrl,
      };
    }),
  );

  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === limit && last
      ? `${new Date(last.deleted_at as string).toISOString()}|${last.id}`
      : null;

  return c.json({ items, next_cursor: nextCursor });
});

/** Soft-delete many items into Trash (recoverable until hard GC). */
mediaRoutes.post("/batch-delete", async (c) => {
  const owner = await requireOwner(c);
  if (owner instanceof Response) return owner;

  const body = await c.req.json<{ ids?: string[] }>();
  const ids = [...new Set((body.ids || []).filter((id) => typeof id === "string" && id))];
  if (!ids.length) return c.json({ error: "ids required" }, 400);
  if (ids.length > 200) return c.json({ error: "too many ids (max 200)" }, 400);

  const db = sql(c.env);
  const result = await db`
    update media
    set deleted_at = now(), status = 'deleted', updated_at = now()
    where archive_id = ${owner.archive.id}
      and deleted_at is null
      and id in ${db(ids)}
    returning id
  `;

  return c.json({
    ok: true,
    deleted_count: result.length,
    deleted_ids: result.map((row) => row.id as string),
  });
});

/** Restore soft-deleted items from Trash back into Photos. */
mediaRoutes.post("/batch-restore", async (c) => {
  const owner = await requireOwner(c);
  if (owner instanceof Response) return owner;

  const body = await c.req.json<{ ids?: string[] }>();
  const ids = [...new Set((body.ids || []).filter((id) => typeof id === "string" && id))];
  if (!ids.length) return c.json({ error: "ids required" }, 400);
  if (ids.length > 200) return c.json({ error: "too many ids (max 200)" }, 400);

  const db = sql(c.env);
  const result = await db`
    update media
    set deleted_at = null, status = 'ready', updated_at = now()
    where archive_id = ${owner.archive.id}
      and deleted_at is not null
      and id in ${db(ids)}
    returning id
  `;

  return c.json({
    ok: true,
    restored_count: result.length,
    restored_ids: result.map((row) => row.id as string),
  });
});

/** Permanently delete soft-deleted items from Trash (DB + R2). */
mediaRoutes.post("/batch-purge", async (c) => {
  const owner = await requireOwner(c);
  if (owner instanceof Response) return owner;

  const body = await c.req.json<{ ids?: string[] }>();
  const ids = [...new Set((body.ids || []).filter((id) => typeof id === "string" && id))];
  if (!ids.length) return c.json({ error: "ids required" }, 400);
  if (ids.length > 200) return c.json({ error: "too many ids (max 200)" }, 400);

  const db = sql(c.env);
  const rows = await db`
    select id, r2_original_key, r2_thumb_key, r2_preview_key, r2_video_poster_key
    from media
    where archive_id = ${owner.archive.id}
      and deleted_at is not null
      and id in ${db(ids)}
  `;

  if (!rows.length) {
    return c.json({ ok: true, purged_count: 0, purged_ids: [] as string[] });
  }

  const purgedIds: string[] = [];
  for (const row of rows) {
    const keys = [
      row.r2_original_key,
      row.r2_thumb_key,
      row.r2_preview_key,
      row.r2_video_poster_key,
    ].filter((key): key is string => typeof key === "string" && key.length > 0);
    const uniqueKeys = [...new Set(keys)];

    for (const key of uniqueKeys) {
      try {
        await deleteObject(c.env, key);
      } catch (err) {
        console.error(`Failed to delete R2 key ${key}`, err);
      }
    }

    await db`
      delete from media
      where id = ${row.id as string}
        and archive_id = ${owner.archive.id}
        and deleted_at is not null
    `;
    purgedIds.push(row.id as string);
  }

  return c.json({
    ok: true,
    purged_count: purgedIds.length,
    purged_ids: purgedIds,
  });
});

mediaRoutes.put("/:id/content", async (c) => {
  const owner = await requireOwner(c);
  if (owner instanceof Response) return owner;

  const id = c.req.param("id");
  const rows = await sql(c.env)`
    select id, r2_original_key, byte_size, mime_type, status
    from media
    where id = ${id}
      and archive_id = ${owner.archive.id}
      and deleted_at is null
    limit 1
  `;
  if (!rows.length) return c.json({ error: "not found" }, 404);

  const media = rows[0] as {
    id: string;
    r2_original_key: string;
    byte_size: number | null;
    mime_type: string;
    status: string;
  };

  if (media.status === "ready") {
    return c.json({ media_id: id, status: "ready", already_ready: true });
  }

  const contentType = c.req.header("content-type") || media.mime_type;
  const body = await c.req.arrayBuffer();
  if (!body.byteLength) {
    return c.json({ error: "empty body" }, 400);
  }
  if (media.byte_size && body.byteLength !== Number(media.byte_size)) {
    return c.json(
      {
        error: "size mismatch",
        expected: media.byte_size,
        received: body.byteLength,
      },
      400,
    );
  }

  await putObject(c.env, media.r2_original_key, body, contentType);

  await sql(c.env)`
    update media
    set status = 'ready',
        r2_preview_key = r2_original_key,
        r2_thumb_key = r2_original_key,
        updated_at = now()
    where id = ${id}
  `;

  return c.json({ media_id: id, status: "ready" });
});

mediaRoutes.post("/:id/complete", async (c) => {
  const owner = await requireOwner(c);
  if (owner instanceof Response) return owner;

  const id = c.req.param("id");
  const rows = await sql(c.env)`
    select id, r2_original_key, byte_size, status
    from media
    where id = ${id}
      and archive_id = ${owner.archive.id}
      and deleted_at is null
    limit 1
  `;
  if (!rows.length) return c.json({ error: "not found" }, 404);

  const media = rows[0] as {
    id: string;
    r2_original_key: string;
    byte_size: number | null;
    status: string;
  };

  try {
    const head = await headObject(c.env, media.r2_original_key);
    if (
      media.byte_size &&
      head.ContentLength &&
      head.ContentLength !== Number(media.byte_size)
    ) {
      await sql(c.env)`
        update media set status = 'failed', updated_at = now() where id = ${id}
      `;
      return c.json({ error: "size mismatch" }, 400);
    }
  } catch {
    return c.json({ error: "object not found in R2" }, 400);
  }

  // Phase 1: mark ready immediately; derivative worker comes later.
  await sql(c.env)`
    update media
    set status = 'ready',
        r2_preview_key = r2_original_key,
        r2_thumb_key = r2_original_key,
        updated_at = now()
    where id = ${id}
  `;

  return c.json({ media_id: id, status: "ready" });
});

mediaRoutes.get("/:id/download", async (c) => {
  const owner = await requireOwner(c);
  if (owner instanceof Response) return owner;
  const id = c.req.param("id");

  const rows = await sql(c.env)`
    select id, r2_original_key, mime_type, taken_at, uploaded_at
    from media
    where id = ${id}
      and archive_id = ${owner.archive.id}
      and status in ('ready', 'deleted')
    limit 1
  `;
  if (!rows.length) return c.json({ error: "not found" }, 404);

  const media = rows[0] as {
    id: string;
    r2_original_key: string;
    mime_type: string;
    taken_at: string | null;
    uploaded_at: string;
  };

  const key = media.r2_original_key;
  const ext = key.includes(".") ? key.slice(key.lastIndexOf(".") + 1) : "bin";
  const stamp = new Date(media.taken_at || media.uploaded_at)
    .toISOString()
    .slice(0, 10);
  const filename = `archive-${stamp}-${media.id.slice(0, 8)}.${ext}`;

  // Same-origin proxy URL avoids browser→R2 CORS for downloads.
  return c.json({
    download_url: `/api/owner/media/${id}/content?download=1`,
    filename,
    mime_type: media.mime_type,
  });
});

mediaRoutes.get("/:id/content", async (c) => {
  const owner = await requireOwner(c);
  if (owner instanceof Response) return owner;
  const id = c.req.param("id");
  const asDownload = c.req.query("download") === "1";

  const rows = await sql(c.env)`
    select id, r2_original_key, mime_type, taken_at, uploaded_at
    from media
    where id = ${id}
      and archive_id = ${owner.archive.id}
      and deleted_at is null
      and status = 'ready'
    limit 1
  `;
  if (!rows.length) return c.json({ error: "not found" }, 404);

  const media = rows[0] as {
    id: string;
    r2_original_key: string;
    mime_type: string;
    taken_at: string | null;
    uploaded_at: string;
  };

  const object = await getObject(c.env, media.r2_original_key);
  if (!object.Body) return c.json({ error: "object missing" }, 404);

  const bytes = await object.Body.transformToByteArray();
  const payload = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const ext = media.r2_original_key.includes(".")
    ? media.r2_original_key.slice(media.r2_original_key.lastIndexOf(".") + 1)
    : "bin";
  const stamp = new Date(media.taken_at || media.uploaded_at)
    .toISOString()
    .slice(0, 10);
  const filename = `archive-${stamp}-${media.id.slice(0, 8)}.${ext}`;

  return c.body(payload, 200, {
    "Content-Type": media.mime_type || "application/octet-stream",
    ...(asDownload
      ? {
          "Content-Disposition": `attachment; filename="${filename}"`,
        }
      : {}),
    "Cache-Control": "private, max-age=60",
  });
});

mediaRoutes.patch("/:id", async (c) => {
  const owner = await requireOwner(c);
  if (owner instanceof Response) return owner;
  const id = c.req.param("id");
  const body = await c.req.json<{
    caption?: string | null;
    alt_text?: string | null;
    taken_at?: string | null;
  }>();

  const existing = await sql(c.env)`
    select id from media
    where id = ${id} and archive_id = ${owner.archive.id} and deleted_at is null
    limit 1
  `;
  if (!existing.length) return c.json({ error: "not found" }, 404);

  let takenAtIso: string | null | undefined = undefined;
  let sortAtIso: string | undefined;
  if (body.taken_at !== undefined) {
    if (body.taken_at === null) {
      takenAtIso = null;
    } else {
      const d = new Date(body.taken_at);
      if (Number.isNaN(d.getTime())) return c.json({ error: "invalid taken_at" }, 400);
      takenAtIso = d.toISOString();
      sortAtIso = takenAtIso;
    }
  }

  if (body.caption !== undefined) {
    await sql(c.env)`update media set caption = ${body.caption}, updated_at = now() where id = ${id}`;
  }
  if (body.alt_text !== undefined) {
    await sql(c.env)`update media set alt_text = ${body.alt_text}, updated_at = now() where id = ${id}`;
  }
  if (takenAtIso !== undefined) {
    await sql(c.env)`
      update media set
        taken_at = ${takenAtIso},
        sort_at = coalesce(${sortAtIso ?? null}, sort_at),
        taken_at_source = 'client',
        updated_at = now()
      where id = ${id}
    `;
  }

  return c.json({ ok: true });
});

mediaRoutes.delete("/:id", async (c) => {
  const owner = await requireOwner(c);
  if (owner instanceof Response) return owner;
  const id = c.req.param("id");

  const result = await sql(c.env)`
    update media
    set deleted_at = now(), status = 'deleted', updated_at = now()
    where id = ${id}
      and archive_id = ${owner.archive.id}
      and deleted_at is null
    returning id
  `;

  if (!result.length) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});
