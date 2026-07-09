import { Hono } from "hono";
import type { Env } from "../types";
import { requireOwner } from "../lib/auth";
import { sql } from "../lib/db";
import { presignGet } from "../lib/r2";

export const albumRoutes = new Hono<{ Bindings: Env }>();

function slugify(input: string) {
  const slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "album";
}

async function mapAlbumRow(
  env: Env,
  row: Record<string, unknown>,
) {
  const coverKey = (row.r2_thumb_key ||
    row.r2_preview_key ||
    row.r2_original_key) as string | null;
  const coverUrl = coverKey ? await presignGet(env, coverKey, 3600) : null;
  return {
    id: row.id as string,
    year: row.year as number,
    location_slug: row.location_slug as string,
    title: row.title as string,
    description: (row.description as string | null) ?? null,
    visibility: row.visibility as string,
    media_count: Number(row.media_count || 0),
    photo_count: Number(row.photo_count || 0),
    video_count: Number(row.video_count || 0),
    start_date: (row.start_date as string | null) ?? null,
    end_date: (row.end_date as string | null) ?? null,
    published_at: (row.published_at as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    cover_url: coverUrl,
  };
}

albumRoutes.get("/", async (c) => {
  const owner = await requireOwner(c);
  if (owner instanceof Response) return owner;

  const rows = await sql(c.env)`
    select
      a.id,
      a.year,
      a.location_slug,
      a.title,
      a.description,
      a.visibility,
      a.media_count,
      a.photo_count,
      a.video_count,
      a.start_date,
      a.end_date,
      a.published_at,
      a.created_at,
      a.updated_at,
      a.cover_media_id,
      m.r2_thumb_key,
      m.r2_preview_key,
      m.r2_original_key
    from albums a
    left join media m
      on m.id = a.cover_media_id
      and m.deleted_at is null
    where a.archive_id = ${owner.archive.id}
    order by a.year desc, a.title asc
  `;

  const albums = await Promise.all(
    rows.map((row) => mapAlbumRow(c.env, row as Record<string, unknown>)),
  );

  return c.json({ albums });
});

albumRoutes.post("/", async (c) => {
  const owner = await requireOwner(c);
  if (owner instanceof Response) return owner;

  const body = await c.req.json<{ title?: string }>();
  const title = body.title?.trim() || "";
  if (!title) return c.json({ error: "title required" }, 400);
  if (title.length > 120) return c.json({ error: "title too long" }, 400);

  const year = new Date().getUTCFullYear();
  const baseSlug = slugify(title);
  let locationSlug = baseSlug;
  let attempt = 1;

  while (attempt <= 50) {
    const existing = await sql(c.env)`
      select id from albums
      where archive_id = ${owner.archive.id}
        and year = ${year}
        and location_slug = ${locationSlug}
      limit 1
    `;
    if (!existing.length) break;
    attempt += 1;
    locationSlug = `${baseSlug}-${attempt}`;
  }

  if (attempt > 50) {
    return c.json({ error: "could not allocate unique album slug" }, 409);
  }

  const rows = await sql(c.env)`
    insert into albums (archive_id, year, location_slug, title, visibility)
    values (${owner.archive.id}, ${year}, ${locationSlug}, ${title}, 'private')
    returning
      id, year, location_slug, title, description, visibility,
      media_count, photo_count, video_count, start_date, end_date,
      published_at, created_at, updated_at, cover_media_id
  `;

  const created = rows[0] as Record<string, unknown>;
  const album = await mapAlbumRow(c.env, {
    ...created,
    r2_thumb_key: null,
    r2_preview_key: null,
    r2_original_key: null,
  });

  return c.json({ album }, 201);
});

albumRoutes.get("/:id", async (c) => {
  const owner = await requireOwner(c);
  if (owner instanceof Response) return owner;
  const id = c.req.param("id");

  const rows = await sql(c.env)`
    select
      a.id,
      a.year,
      a.location_slug,
      a.title,
      a.description,
      a.visibility,
      a.media_count,
      a.photo_count,
      a.video_count,
      a.start_date,
      a.end_date,
      a.published_at,
      a.created_at,
      a.updated_at,
      a.cover_media_id,
      m.r2_thumb_key,
      m.r2_preview_key,
      m.r2_original_key
    from albums a
    left join media m
      on m.id = a.cover_media_id
      and m.deleted_at is null
    where a.id = ${id}
      and a.archive_id = ${owner.archive.id}
    limit 1
  `;

  if (!rows.length) return c.json({ error: "not found" }, 404);

  const album = await mapAlbumRow(c.env, rows[0] as Record<string, unknown>);
  return c.json({ album });
});

albumRoutes.get("/:id/media", async (c) => {
  const owner = await requireOwner(c);
  if (owner instanceof Response) return owner;
  const id = c.req.param("id");
  const limit = Math.min(Number(c.req.query("limit") || 100), 200);
  const cursor = c.req.query("cursor"); // position|media_id

  const albumRows = await sql(c.env)`
    select id from albums
    where id = ${id} and archive_id = ${owner.archive.id}
    limit 1
  `;
  if (!albumRows.length) return c.json({ error: "not found" }, 404);

  let rows;
  if (cursor) {
    const [sortAt, mediaId] = cursor.split("|");
    rows = await sql(c.env)`
      select
        m.id, m.type, m.status, m.sort_at, m.mime_type, m.width, m.height,
        m.caption, m.r2_original_key, m.r2_thumb_key, m.r2_preview_key,
        m.taken_at, am.position
      from album_media am
      join media m on m.id = am.media_id
      where am.album_id = ${id}
        and m.deleted_at is null
        and m.status = 'ready'
        and (m.sort_at, m.id) < (${sortAt}::timestamptz, ${mediaId}::uuid)
      order by m.sort_at desc, m.id desc
      limit ${limit}
    `;
  } else {
    rows = await sql(c.env)`
      select
        m.id, m.type, m.status, m.sort_at, m.mime_type, m.width, m.height,
        m.caption, m.r2_original_key, m.r2_thumb_key, m.r2_preview_key,
        m.taken_at, am.position
      from album_media am
      join media m on m.id = am.media_id
      where am.album_id = ${id}
        and m.deleted_at is null
        and m.status = 'ready'
      order by m.sort_at desc, m.id desc
      limit ${limit}
    `;
  }

  const items = await Promise.all(
    rows.map(async (row) => {
      const key = (row.r2_thumb_key ||
        row.r2_preview_key ||
        row.r2_original_key) as string;
      const thumbUrl = await presignGet(c.env, key, 3600);
      return {
        id: row.id as string,
        type: row.type as string,
        sort_at: row.sort_at as string,
        taken_at: (row.taken_at as string | null) ?? null,
        width: (row.width as number | null) ?? null,
        height: (row.height as number | null) ?? null,
        caption: (row.caption as string | null) ?? null,
        mime_type: row.mime_type as string,
        thumb_url: thumbUrl,
        preview_url: thumbUrl,
        position: Number(row.position),
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

/** Attach existing archive photos to an album (no R2 copies). */
albumRoutes.post("/:id/media/batch-add", async (c) => {
  const owner = await requireOwner(c);
  if (owner instanceof Response) return owner;
  const id = c.req.param("id");

  const body = await c.req.json<{ media_ids?: string[] }>();
  const mediaIds = [
    ...new Set(
      (body.media_ids || []).filter((mediaId) => typeof mediaId === "string" && mediaId),
    ),
  ];
  if (!mediaIds.length) return c.json({ error: "media_ids required" }, 400);
  if (mediaIds.length > 200) {
    return c.json({ error: "too many media_ids (max 200)" }, 400);
  }

  const albumRows = await sql(c.env)`
    select id, cover_media_id from albums
    where id = ${id} and archive_id = ${owner.archive.id}
    limit 1
  `;
  if (!albumRows.length) return c.json({ error: "not found" }, 404);

  const db = sql(c.env);
  const validMedia = await db`
    select id, type
    from media
    where archive_id = ${owner.archive.id}
      and deleted_at is null
      and status = 'ready'
      and id in ${db(mediaIds)}
  `;
  if (!validMedia.length) {
    return c.json({ ok: true, added_count: 0, added_ids: [] as string[] });
  }

  const maxPosRows = await db`
    select coalesce(max(position), 0)::bigint as max_position
    from album_media
    where album_id = ${id}
  `;
  let nextPosition = Number(maxPosRows[0]?.max_position || 0) + 1000;

  const addedIds: string[] = [];
  let addedPhotos = 0;
  let addedVideos = 0;

  for (const media of validMedia) {
    const mediaId = media.id as string;
    const inserted = await db`
      insert into album_media (album_id, media_id, position)
      values (${id}, ${mediaId}, ${nextPosition})
      on conflict (album_id, media_id) do nothing
      returning media_id
    `;
    if (!inserted.length) continue;

    addedIds.push(mediaId);
    nextPosition += 1000;
    if (media.type === "video") addedVideos += 1;
    else addedPhotos += 1;
  }

  if (addedIds.length) {
    const album = albumRows[0] as { id: string; cover_media_id: string | null };
    if (!album.cover_media_id) {
      await db`
        update albums
        set
          cover_media_id = ${addedIds[0]},
          media_count = media_count + ${addedIds.length},
          photo_count = photo_count + ${addedPhotos},
          video_count = video_count + ${addedVideos},
          updated_at = now()
        where id = ${id}
      `;
    } else {
      await db`
        update albums
        set
          media_count = media_count + ${addedIds.length},
          photo_count = photo_count + ${addedPhotos},
          video_count = video_count + ${addedVideos},
          updated_at = now()
        where id = ${id}
      `;
    }
  }

  return c.json({
    ok: true,
    added_count: addedIds.length,
    added_ids: addedIds,
  });
});
