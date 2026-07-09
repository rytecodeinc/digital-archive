import { Hono } from "hono";
import type { Env } from "../types";
import { requireOwner } from "../lib/auth";
import { sql } from "../lib/db";
import { presignGet } from "../lib/r2";

export const albumRoutes = new Hono<{ Bindings: Env }>();

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
    rows.map(async (row) => {
      const coverKey = (row.r2_thumb_key ||
        row.r2_preview_key ||
        row.r2_original_key) as string | null;
      const coverUrl = coverKey ? await presignGet(c.env, coverKey, 3600) : null;
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
    }),
  );

  return c.json({ albums });
});
