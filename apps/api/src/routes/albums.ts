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
