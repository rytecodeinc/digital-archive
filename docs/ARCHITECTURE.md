# Travel Memory Archive — Architecture

A personal travel archive that preserves every photo and video in a private chronological timeline (Google Photos–style), while allowing curated public travel albums. Object bytes live once in Cloudflare R2; albums only reference media IDs.

This document is the design source of truth before implementation.

---

## 1. Goals and constraints

| Goal | Implication |
|---|---|
| Complete photo/video history | Every upload becomes a first-class `media` row; timeline is the source of truth |
| Curated travel albums | Albums are ordered views over the same media; no file copies |
| Millions of items | Cursor pagination, denormalized counters, R2 direct I/O, no backend media proxy |
| Minimize backend calls | Presigned uploads, CDN delivery, batch mutations, client caches |
| Owner vs viewer | Owner: timeline + full CRUD. Viewer (logged out): public albums / slideshow / single media only — never the internal timeline |
| Album UI later | Album presentation is API-ready; visual design is out of scope here |

Non-goals for v1: multi-owner collaboration, face recognition, social sharing graphs, mobile native apps (web-first).

---

## 2. High-level architecture

```
┌─────────────────┐     presigned PUT / GET      ┌──────────────────┐
│  Web client     │ ───────────────────────────► │ Cloudflare R2    │
│  (owner/viewer) │ ◄─────────────────────────── │ originals +      │
└────────┬────────┘     CDN / signed URLs        │ derivatives      │
         │                                        └────────▲─────────┘
         │ JSON API (auth, metadata, albums)               │
         ▼                                                 │ worker writes
┌─────────────────┐     async jobs (derivatives)  ┌───────┴─────────┐
│ API (Workers)   │ ────────────────────────────► │ Queue / Worker  │
└────────┬────────┘                               │ (thumb/transcode)│
         │                                        └─────────────────┘
         ▼
┌─────────────────┐
│ Metadata DB     │  media, albums, album_media, users, sessions
│ (Postgres)      │
└─────────────────┘
```

**Recommended stack (Cloudflare-centric):**

| Layer | Choice | Why |
|---|---|---|
| API | Cloudflare Workers (+ Hono or similar) | Edge auth/metadata; same vendor as R2 |
| Object storage | Cloudflare R2 | S3-compatible, no egress fees to Cloudflare |
| CDN | R2 custom domain via Cloudflare | Media never streams through the API |
| Metadata DB | Postgres via Hyperdrive (Neon/Supabase/etc.) | Millions of rows, rich indexes, joins for albums |
| Auth | Session cookies (owner) + optional magic link / OAuth | Single owner account type for v1 |
| Async work | Cloudflare Queues + Workers | Thumbnail / video poster generation after upload |
| Cache | Cache API + CDN cache for public album payloads | Cut repeat metadata hits for viewers |

**Why not D1 alone?** D1 can work early, but album joins + timeline range scans at multi-million scale are safer on Postgres with B-tree indexes and connection pooling (Hyperdrive).

---

## 3. Core domain model

### 3.1 Two surfaces, one media library

```
                    ┌────────────────────────────┐
                    │         media              │
                    │  (canonical archive item)  │
                    │  bytes in R2, once         │
                    └─────────────┬──────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
              ▼                   ▼                   ▼
     Owner Timeline          Album A              Album B
     (all media,             (ordered             (ordered
      taken_at ASC/DESC)      subset)              subset)
```

- **Archive timeline** = every `media` row the owner uploaded, ordered by capture time (`taken_at`), falling back to `uploaded_at`.
- **Album** = named, ordered collection of references (`album_media`) into that same library.
- Adding/removing album membership never copies or deletes R2 objects.
- Deleting media from the archive removes the object (and all album memberships). Removing from an album only deletes the join row.

### 3.2 Visibility rules

| Surface | Owner (authenticated) | Viewer (logged out) |
|---|---|---|
| Full timeline `/timeline` | Yes | **No** (404 / 401) |
| Media CRUD | Yes | No |
| Album create / edit / reorder | Yes | No |
| Public album view | Yes | Yes (if `visibility = public`) |
| Slideshow / single media in public album | Yes | Yes |
| Private / unlisted album | Yes | Only with valid share token (optional v1.1) |
| Direct media URL guessing | Blocked via non-guessable keys + signed URLs for private; public album derivatives may use cacheable public URLs |

Viewers must never receive APIs that list “all media” or “media by date range across the archive.” Public endpoints are always scoped to an album (or a single media ID that is a member of a public album).

---

## 4. Database schema

Postgres. UUIDs for public IDs; `bigint` internal keys optional. Timestamps in UTC (`timestamptz`).

### 4.1 `users`

Single-owner product, but keep a real user table for sessions and future roles.

```sql
create table users (
  id              uuid primary key default gen_random_uuid(),
  email           citext not null unique,
  display_name    text not null,
  role            text not null check (role in ('owner')),  -- extend later: 'editor'
  password_hash   text,          -- or omit if magic-link / OAuth only
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
```

### 4.2 `sessions`

```sql
create table sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  token_hash      bytea not null unique,
  expires_at      timestamptz not null,
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz
);
create index sessions_user_id_idx on sessions(user_id);
```

### 4.3 `media` — canonical archive item

One row per uploaded photo or video. **This is the timeline.**

```sql
create type media_type as enum ('photo', 'video');
create type media_status as enum ('pending_upload', 'processing', 'ready', 'failed', 'deleted');

create table media (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references users(id),

  type              media_type not null,
  status            media_status not null default 'pending_upload',

  -- Capture / archive ordering (timeline sort key)
  taken_at          timestamptz,              -- from EXIF/container; nullable until extracted
  taken_at_source   text check (taken_at_source in ('exif', 'client', 'upload')),
  uploaded_at       timestamptz not null default now(),
  -- Effective sort: coalesce(taken_at, uploaded_at)
  sort_at           timestamptz not null,     -- maintained by trigger/app on write

  -- File identity (dedupe + integrity)
  content_hash      bytea,                    -- sha256 of original bytes; unique per owner when set
  byte_size         bigint,
  mime_type         text not null,
  width             int,
  height            int,
  duration_ms       int,                      -- video only

  -- R2 object keys (no duplicated album copies)
  r2_original_key   text not null unique,
  r2_thumb_key      text,                     -- small JPEG/WebP
  r2_preview_key    text,                     -- display-sized still or video poster
  r2_video_poster_key text,

  -- Lightweight editable metadata
  caption           text,
  alt_text          text,
  location_name     text,                     -- human label; lat/lng optional below
  latitude          double precision,
  longitude         double precision,

  exif_json         jsonb,                    -- stripped/selected EXIF; not required for list views
  client_local_id   text,                     -- idempotent uploads from client

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz               -- soft delete; GC job removes R2 + hard-deletes
);

-- Timeline: owner browses newest/oldest
create index media_timeline_idx
  on media (owner_id, sort_at desc, id desc)
  where deleted_at is null and status = 'ready';

-- Dedupe uploads
create unique index media_owner_hash_uidx
  on media (owner_id, content_hash)
  where content_hash is not null and deleted_at is null;

create unique index media_owner_client_local_uidx
  on media (owner_id, client_local_id)
  where client_local_id is not null;
```

**Soft delete:** Owner delete marks `deleted_at` and enqueues R2 cleanup. Album join rows cascade-delete or are removed by trigger so public albums never surface tombstones.

### 4.4 `albums`

```sql
create type album_visibility as enum ('private', 'unlisted', 'public');

create table albums (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references users(id),
  slug            text not null,              -- public URL key, unique per owner
  title           text not null,
  description     text,
  visibility      album_visibility not null default 'private',
  cover_media_id  uuid references media(id) on delete set null,

  -- Denormalized for list endpoints (avoid count(*) on every request)
  media_count     int not null default 0,
  photo_count     int not null default 0,
  video_count     int not null default 0,

  published_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (owner_id, slug)
);

create index albums_public_list_idx
  on albums (visibility, published_at desc)
  where visibility = 'public';
```

### 4.5 `album_media` — membership without file duplication

```sql
create table album_media (
  album_id        uuid not null references albums(id) on delete cascade,
  media_id        uuid not null references media(id) on delete cascade,
  position        bigint not null,            -- dense or sparse ordering (see §6)
  added_at        timestamptz not null default now(),
  primary key (album_id, media_id)
);

create unique index album_media_position_uidx
  on album_media (album_id, position);

create index album_media_media_id_idx
  on album_media (media_id);
```

**Invariant:** `media.owner_id` must equal `albums.owner_id` for every membership (enforce in API; optional DB trigger).

### 4.6 Optional: `share_links` (v1.1)

For unlisted albums:

```sql
create table share_links (
  id              uuid primary key default gen_random_uuid(),
  album_id        uuid not null references albums(id) on delete cascade,
  token_hash      bytea not null unique,
  expires_at      timestamptz,
  created_at      timestamptz not null default now()
);
```

### 4.7 Entity relationship (summary)

```
users 1──* media
users 1──* albums
albums *──* media          via album_media
albums 0..1── cover → media
```

---

## 5. Media storage strategy (Cloudflare R2)

### 5.1 Bucket layout

Single bucket (or one private + one public derivatives bucket). Keys are content-addressable where possible:

```
r2://travel-archive/
  originals/{owner_id}/{yyyy}/{mm}/{media_id}/{content_hash}.{ext}
  derivatives/{owner_id}/{media_id}/thumb.webp
  derivatives/{owner_id}/{media_id}/preview.webp
  derivatives/{owner_id}/{media_id}/poster.jpg
```

Rules:

1. **Originals are immutable.** Edits (caption, album membership, rotation flag) are metadata-only unless the owner replaces the file (new `media` version or new hash).
2. **No per-album object copies.** Album “cover” is a pointer to `media_id`.
3. **Derivatives are regenerable** from originals; safe to delete and rebuild.
4. **Content-hash in key + DB** enables idempotent re-uploads and storage dedupe for identical files.

### 5.2 Upload path (minimizes backend)

Owner uploads **directly to R2** with a short-lived presigned URL. The API only issues credentials and records metadata.

```
1. Client: POST /api/owner/media/upload-sessions
     body: { mime_type, byte_size, content_hash?, client_local_id?, taken_at? }
2. API:  create media row (status=pending_upload), return {
           media_id, upload_url, upload_headers, expires_at
         }
3. Client: PUT bytes → R2 (no API bandwidth)
4. Client: POST /api/owner/media/{id}/complete
5. API:  verify object exists/size/hash (HeadObject), set status=processing,
         enqueue derivative job
6. Worker: write thumb/preview/poster keys, set status=ready, fill dimensions/exif/sort_at
```

Batch variant: `POST /api/owner/media/upload-sessions:batch` returns N presigned URLs in one round trip (critical for phone dumps).

### 5.3 Download / view path (minimizes backend)

| Asset | Owner timeline | Public album viewer |
|---|---|---|
| Thumb / preview | Signed URL (TTL 1h) or Worker-signed cookie | Public CDN URL if album is public; else signed |
| Original | Signed URL, short TTL, owner-only | Not exposed by default |
| Video | Signed URL to original or future transcoded rendition | Same visibility as album |

**Do not** stream media through the Worker. Return URLs; let the browser hit R2/CDN.

For public albums, prefer a **public derivatives prefix** or signed URLs embedded in a cacheable album manifest so slideshow advance does not call the API per slide.

### 5.4 Processing pipeline

Queue consumer responsibilities:

- Image: EXIF extract → orient → `thumb` (≤400px) + `preview` (≤2048px) WebP
- Video: probe duration/dims → poster frame → optional later HLS (out of scope v1)
- Update `media` row; on failure set `status=failed` with error code

### 5.5 Deletion and GC

1. Soft-delete `media` → remove `album_media` rows → decrement album counters  
2. Async job deletes R2 keys for original + derivatives  
3. Hard-delete DB row after successful GC  

Album remove ≠ media delete.

### 5.6 Scale notes (millions of objects)

- R2 handles object count; DB list performance is the bottleneck — always keyset pagination on `(sort_at, id)`.
- Store list payloads without `exif_json`.
- Keep `media_count` on albums updated transactionally.
- Optional monthly partitions on `media` by `sort_at` only if a single B-tree becomes hot (defer until measured).

---

## 6. Album ordering strategy

Use **sparse `bigint` positions** (e.g. gaps of 1000) so reordering one item is usually a single-row update. When gaps collapse, renormalize positions for that album in one transaction.

API supports:

- Append: `position = max+1000`
- Insert before/after
- `PUT` full order for small albums (`media_ids: uuid[]`) when the album fits in one payload
- Batch add/remove: up to N IDs per request

---

## 7. API structure

Base: `/api`. JSON. Owner routes require session cookie. Public routes are unauthenticated and **album-scoped**.

### 7.1 Auth

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/auth/login` | email + secret / magic link |
| `POST` | `/api/auth/logout` | revoke session |
| `GET` | `/api/auth/me` | `{ id, email, role }` or 401 |

### 7.2 Owner — media & timeline

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/owner/media/upload-sessions` | create row + presigned PUT |
| `POST` | `/api/owner/media/upload-sessions:batch` | batch presign |
| `POST` | `/api/owner/media/:id/complete` | finalize upload |
| `GET` | `/api/owner/timeline` | cursor page of archive (`?cursor=&limit=&order=desc`) |
| `GET` | `/api/owner/media/:id` | full metadata + signed URLs |
| `PATCH` | `/api/owner/media/:id` | caption, alt, location, taken_at correction |
| `DELETE` | `/api/owner/media/:id` | soft-delete archive item |
| `POST` | `/api/owner/media:batchDelete` | batch soft-delete |
| `GET` | `/api/owner/media/:id/albums` | which albums include this item |

**Timeline response shape (compact):**

```json
{
  "items": [
    {
      "id": "...",
      "type": "photo",
      "sort_at": "2024-06-12T18:22:00Z",
      "width": 4032,
      "height": 3024,
      "thumb_url": "https://...",
      "preview_url": "https://...",
      "caption": null
    }
  ],
  "next_cursor": "2024-06-12T18:22:00Z_uuid"
}
```

No originals in list responses.

### 7.3 Owner — albums

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/owner/albums` | all albums (incl. private) |
| `POST` | `/api/owner/albums` | create |
| `GET` | `/api/owner/albums/:id` | detail + first page of members |
| `PATCH` | `/api/owner/albums/:id` | title, description, visibility, cover |
| `DELETE` | `/api/owner/albums/:id` | delete album only |
| `POST` | `/api/owner/albums/:id/media:batchAdd` | `{ media_ids: [] }` |
| `POST` | `/api/owner/albums/:id/media:batchRemove` | `{ media_ids: [] }` |
| `PUT` | `/api/owner/albums/:id/media/order` | reorder |
| `GET` | `/api/owner/albums/:id/media` | paginated members |

### 7.4 Public — viewers (no timeline)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/public/albums` | optional index of public albums |
| `GET` | `/api/public/albums/:slug` | album manifest: metadata + ordered media page |
| `GET` | `/api/public/albums/:slug/media` | paginated / cursor for large albums |
| `GET` | `/api/public/albums/:slug/media/:mediaId` | single item in album context |
| `GET` | `/api/public/albums/:slug/slideshow` | optimized payload: ids + preview URLs + dims |

Explicitly **absent**: `/api/public/timeline`, `/api/public/media` (unscoped).

Authorization check for every public media access:

```
media is ready
AND exists album_media join to album
AND album.visibility = 'public' (or valid share token for unlisted)
```

### 7.5 Minimizing backend calls — API design tactics

1. **Presigned uploads** — bytes never touch Workers.  
2. **Album manifest** — one response with enough preview URLs for the first N slides; client paginates only for huge albums.  
3. **Slideshow endpoint** — returns a slim array so the viewer can advance locally without per-slide API calls.  
4. **Batch add/remove/delete** — one request for multi-select curation.  
5. **Signed URL bundling** — list endpoints include short-lived URLs; client refreshes the page/manifest when near expiry instead of per-image auth calls.  
6. **HTTP caching** — `Cache-Control` on public album GETs (e.g. 60s CDN + stale-while-revalidate); purge on owner publish.  
7. **ETags / `If-None-Match`** on album manifests.  
8. **Client IndexedDB** (owner) — cache timeline pages; revalidate with cursor/`updated_at`.

---

## 8. Permissions model

### 8.1 Roles

| Role | How authenticated | Capabilities |
|---|---|---|
| `owner` | Session | Upload; edit metadata; delete media; create/edit/delete albums; add/remove/reorder album media; view timeline; publish visibility |
| `viewer` | None (logged out) | Read public album metadata + media URLs; slideshow; individual public media. **No timeline. No mutations.** |

v1 assumes a single owner account. If “account type” later expands, add `role` values and map the same capability matrix; do not invent a second media table.

### 8.2 Capability matrix

| Action | Owner | Viewer |
|---|---|---|
| View internal timeline | ✓ | ✗ |
| Upload photo/video | ✓ | ✗ |
| Edit caption / taken_at / location | ✓ | ✗ |
| Delete media from archive | ✓ | ✗ |
| Create album | ✓ | ✗ |
| Add/remove media in album | ✓ | ✗ |
| Reorder album / set cover | ✓ | ✗ |
| Change album visibility | ✓ | ✗ |
| View public album | ✓ | ✓ |
| Slideshow / single public item | ✓ | ✓ |
| Download original | ✓ | ✗ (optional later: allow on public) |

Enforce on every owner route: valid session + `users.role = 'owner'`. Enforce on public routes: album visibility, never trust client-provided “isPublic.”

---

## 9. User flows

### 9.1 Owner — ingest into archive

```
Login → Upload UI → (hash files client-side optional)
  → batch upload-sessions → parallel PUTs to R2 → batch/complete
  → items appear in Timeline as processing → ready
```

Timeline is automatic: **upload = archive membership.** No “add to library” step.

### 9.2 Owner — curate an album

```
Timeline or Media picker
  → multi-select
  → “Add to album” (existing or new)
  → batchAdd
  → optional reorder / set cover / write description
  → set visibility public when ready
```

Curation never leaves the archive. Removing from album keeps the timeline entry.

### 9.3 Owner — edit / delete

- **Edit:** PATCH metadata; optional “correct capture time” updates `sort_at` and timeline position.  
- **Delete from album:** `batchRemove` only.  
- **Delete from archive:** `DELETE media` — disappears from timeline and all albums; R2 GC async.

### 9.4 Viewer — browse & slideshow

```
Open /a/:slug
  → GET public album manifest (cached)
  → grid or start slideshow
  → advance using in-memory list; fetch next page only near end
  → open single media route for deep links / share
```

Viewer never sees date-grouped “entire life” UI or APIs.

### 9.5 Relationship summary (product)

| Question | Answer |
|---|---|
| Where do files live? | Once in R2, keyed by `media` |
| What is the timeline? | Ordered query over all owner `media` |
| What is an album? | Ordered subset via `album_media` |
| Can one photo be in many albums? | Yes |
| Does album publish expose the timeline? | No — only that album’s members |
| Can viewers scrape the archive via IDs? | Only if they know IDs **and** those IDs are in a public album; unscoped media GET is denied |

---

## 10. Pagination and performance contracts

- **Keyset cursors only** (no `OFFSET` for timeline/album media).  
- Default page size: 50–100 thumbs; slideshow manifest may return up to 500 slim entries, then cursor.  
- List projections exclude `exif_json` and original URLs.  
- Owner timeline filter hooks (by year/month) use `sort_at` range + same index.  
- Target: viewer slideshow after first manifest = **0 API calls** until page boundary or URL refresh.

---

## 11. Security and privacy

- Owner session: `HttpOnly`, `Secure`, `SameSite=Lax` cookie; CSRF on cookie-authenticated mutations.  
- Presigned uploads: constrain `Content-Type`, `Content-Length`, key, short TTL (e.g. 15 minutes).  
- Private media: no public ACL; signed GET only.  
- Public albums: expose derivatives (and optionally previews), not necessarily originals.  
- Strip sensitive EXIF (GPS) from **public** payloads by default; owner timeline may retain location.  
- Rate-limit auth and presign endpoints.  
- Soft-delete + async GC to avoid public/CDN races.

---

## 12. Suggested project layout (for later implementation)

```
/
  apps/web/                 # owner + public UI
  apps/api/                 # Cloudflare Worker API
  apps/worker-media/        # derivative pipeline consumer
  packages/db/              # schema, migrations, query helpers
  packages/r2/              # key builders, presign helpers
  docs/ARCHITECTURE.md      # this file
```

---

## 13. Implementation phases (guidance only)

1. **Schema + auth + R2 presign + timeline list** — archive works like a private Photos library.  
2. **Derivative worker** — thumbs/previews for performant UI.  
3. **Albums CRUD + album_media** — curation without duplication.  
4. **Public album + slideshow APIs** — viewer surface; lock down timeline.  
5. **Caching, batch endpoints, GC** — harden for large libraries.

---

## 14. Decision record (short)

| Decision | Choice | Rationale |
|---|---|---|
| Canonical store | `media` table + R2 originals | Single source of truth for history |
| Albums | M2M join with positions | Zero file duplication; many albums per asset |
| Timeline vs albums | Timeline = all media; albums = curated subsets | Matches Google Photos library vs albums mental model |
| Viewer access | Public album-scoped APIs only | Hides internal timeline |
| Upload/delivery | Presigned R2 + CDN | Minimizes backend bandwidth and calls |
| Metadata DB | Postgres | Scale to millions of rows with proper indexes |
| Deletes | Soft delete + async R2 GC | Safe album/CDN consistency |

---

## 15. Open points for UI phase (intentionally deferred)

- Visual design of album pages and slideshow chrome  
- Exact owner timeline grouping (by day/trip) — can be client-side from `sort_at`  
- Map view, trip entities, or auto-albums  
- Video transcoding / HLS  
- Multi-device upload agents  

The data model and APIs above are sufficient to implement those later without migrating object storage.
