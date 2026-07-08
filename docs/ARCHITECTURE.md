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
| Direct device upload | Owner uploads from phone or computer via the web app (camera roll / file picker → R2); no Google Photos auto-sync |
| Single owner + transferable | One active archive owner at a time; ownership can later transfer to another user (Sheets-style) |
| Public trip URLs | Human paths like `/2026/malaysia` (year + location); optional deeper date paths later |
| v1 scope | Photos only (JPEG/HEIC); upload + private timeline like Google Photos. Video/MP4 and public albums follow |

Non-goals for v1: Google OAuth, Google Photos library sync, multi-owner collaboration, face recognition, social graphs, native Swift app, video processing.

### Product decisions (locked from owner)

| Topic | Decision |
|---|---|
| Ingest | Direct upload from phone/computer in the web app |
| Google Photos | No automatic sync (API no longer allows full-library access). Optional later: Google Takeout import tool, or Photos Picker for manual selection |
| Hosting | **Not GitHub Pages alone** (static-only). Frontend on Cloudflare Pages (or GH Pages) + API/Workers + R2 + Postgres. Free `*.pages.dev` / Worker subdomain until a custom domain exists |
| Library size | ~20GB; mainly JPEG/HEIC (+ MP4 later). Fits comfortably in R2 |
| Ownership | Single owner now (`rinarasia@icloud.com`); schema supports `archives.owner_user_id` + transfer flow later |
| Auth (v1) | Email/password or magic link — **no Google OAuth yet** |
| Client strategy | **Web app first** (mobile-responsive); optional native (Swift) companion later sharing the same API |
| Public paths | Prefer `/year/location` (e.g. `/2026/malaysia`). Date-granular paths are optional deep links, not the primary album URL |
| v1 | Photos-only upload + owner timeline |

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
| Auth | Email + password (or magic link) session cookies for v1 | No Google OAuth for now; bootstrap owner `rinarasia@icloud.com` |
| Frontend host | Cloudflare Pages (recommended) | SPA/SSR with HTTPS subdomain; not limited like GitHub Pages |
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

Users authenticate with email (password or magic link in v1). Ownership of the archive is a separate concept so it can be transferred later. Google OAuth can be added later as an alternate login without changing ownership.

```sql
create table users (
  id              uuid primary key default gen_random_uuid(),
  email           citext not null unique,  -- v1 owner: rinarasia@icloud.com
  display_name    text not null,
  password_hash   text,          -- required if password auth; null if magic-link-only
  avatar_url      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- One personal archive for v1; owner_user_id is transferable
create table archives (
  id              uuid primary key default gen_random_uuid(),
  owner_user_id   uuid not null references users(id),
  title           text not null default 'Travel Archive',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table ownership_transfers (
  id              uuid primary key default gen_random_uuid(),
  archive_id      uuid not null references archives(id) on delete cascade,
  from_user_id    uuid not null references users(id),
  to_user_id      uuid not null references users(id),
  status          text not null check (status in ('pending', 'accepted', 'revoked', 'expired')),
  created_at      timestamptz not null default now(),
  accepted_at     timestamptz
);
```

**Permission check:** “Is owner?” = `archives.owner_user_id = session.user_id`. Transfer updates that FK (and writes an audit row); media/R2 keys stay put.

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
  archive_id        uuid not null references archives(id),
  uploaded_by       uuid not null references users(id),

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
  on media (archive_id, sort_at desc, id desc)
  where deleted_at is null and status = 'ready';

-- Dedupe uploads
create unique index media_archive_hash_uidx
  on media (archive_id, content_hash)
  where content_hash is not null and deleted_at is null;

create unique index media_archive_client_local_uidx
  on media (archive_id, client_local_id)
  where client_local_id is not null;
```

**Soft delete:** Owner delete marks `deleted_at` and enqueues R2 cleanup. Album join rows cascade-delete or are removed by trigger so public albums never surface tombstones.

### 4.4 `albums`

```sql
create type album_visibility as enum ('private', 'unlisted', 'public');

create table albums (
  id              uuid primary key default gen_random_uuid(),
  archive_id      uuid not null references archives(id),
  -- Public path segments: /{year}/{location_slug}  e.g. /2026/malaysia
  year            int not null,
  location_slug   text not null,              -- lowercase kebab-case
  title           text not null,              -- display: "Malaysia"
  description     text,
  visibility      album_visibility not null default 'private',
  cover_media_id  uuid references media(id) on delete set null,

  -- Optional trip window for deeper links / filters (not required in URL)
  start_date      date,
  end_date        date,

  -- Denormalized for list endpoints (avoid count(*) on every request)
  media_count     int not null default 0,
  photo_count     int not null default 0,
  video_count     int not null default 0,

  published_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (archive_id, year, location_slug)
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

**Invariant:** `media.archive_id` must equal `albums.archive_id` for every membership (enforce in API; optional DB trigger).

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
users 1──* sessions
users 1──* archives (as owner; transferable)
archives 1──* media
archives 1──* albums
albums *──* media          via album_media
albums 0..1── cover → media
```

---

## 5. Media storage strategy (Cloudflare R2)

### 5.1 Bucket layout

Single bucket (or one private + one public derivatives bucket). Keys are content-addressable where possible:

```
r2://travel-archive/
  originals/{archive_id}/{yyyy}/{mm}/{media_id}/{content_hash}.{ext}
  derivatives/{archive_id}/{media_id}/thumb.webp
  derivatives/{archive_id}/{media_id}/preview.webp
  derivatives/{archive_id}/{media_id}/poster.jpg
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
| `GET` | `/api/public/trips/:year/:location` | album manifest for `/2026/malaysia` |
| `GET` | `/api/public/trips/:year/:location/media` | paginated members |
| `GET` | `/api/public/trips/:year/:location/media/:mediaId` | single item in trip context |
| `GET` | `/api/public/trips/:year/:location/slideshow` | slim slideshow payload |

Public **page** routes (frontend): `/{year}/{location}` → e.g. `/2026/malaysia`. Optional deep link later: `/{year}/{location}?date=2026-03-14` or `/{year}/{mm}/{dd}/{location}` if day-level URLs are needed; primary album identity remains year + location.

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
| Archive **owner** | Email login → session; `archives.owner_user_id` | Upload; edit metadata; delete media; create/edit/delete albums; add/remove/reorder; view timeline; publish; initiate ownership transfer |
| Logged-in non-owner | Email login → session | No archive mutations until they accept a transfer (or future collaborator roles) |
| `viewer` | None (logged out) | Read public trip pages + slideshow. **No timeline. No mutations.** |

v1: seed user `rinarasia@icloud.com` as archive owner. Later: Sheets-style transfer via `ownership_transfers` (invite → accept → swap `owner_user_id`). Google OAuth optional later for login convenience only.

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

Enforce on every owner route: valid session + `session.user_id = archives.owner_user_id`. Enforce on public routes: album visibility, never trust client-provided “isPublic.”

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
Open /2026/malaysia
  → GET public trip manifest (cached)
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

1. **Schema + email auth + R2 presign + photo upload + timeline list** — private Photos-like archive on phone/desktop browsers.  
2. **HEIC → display derivatives** — thumbs/previews for performant UI.  
3. **Albums / trips (`year` + `location`)** — curation without duplication.  
4. **Public trip pages + slideshow** — viewer surface; lock down timeline.  
5. **Ownership transfer, Takeout import, video, optional Google login, optional native app** — harden and expand.

---

## 14. Decision record (short)

| Decision | Choice | Rationale |
|---|---|---|
| Canonical store | `media` table + R2 originals | Single source of truth for history |
| Albums / trips | M2M join; public URL `/{year}/{location}` | Zero file duplication; human trip URLs |
| Timeline vs albums | Timeline = all media; albums = curated subsets | Matches Google Photos library vs albums mental model |
| Viewer access | Public trip-scoped APIs only | Hides internal timeline |
| Upload/delivery | Direct device upload via presigned R2 + CDN | Phone/computer ingest; minimizes backend |
| Auth (v1) | Email + password/magic link; owner `rinarasia@icloud.com` | No Google OAuth for now |
| Google Photos | No library sync; optional Takeout import later | Google removed full-library API access (2025) |
| Client | Responsive web first; optional Swift app later | Same API; faster v1; phone upload via mobile browser |
| Hosting | Cloudflare Pages + Workers + R2 (not GH Pages alone) | Needs API, auth, and object storage |
| Ownership | `archives.owner_user_id` + transfer table; seed owner email above | Single owner now; Sheets-style transfer later |
| Metadata DB | Postgres | Scale + indexes |
| Deletes | Soft delete + async R2 GC | Safe album/CDN consistency |
| v1 media | Photos (JPEG/HEIC) only | Defer video pipeline |

---

## 15. Hosting, Google Photos, client choice, and URL notes

### 15.1 Can we self-host on GitHub Pages?

**Not as the whole app.** GitHub Pages serves static files only (HTML/JS/CSS). This archive needs:

- Authenticated API (login, timeline, mutations)
- Presigned R2 uploads
- Postgres metadata
- Optional background thumbnail jobs

**Practical options without buying a domain yet:**

| Piece | Free / cheap host |
|---|---|
| Web UI | Cloudflare Pages → `https://<project>.pages.dev` |
| API | Cloudflare Workers → `https://<worker>.<subdomain>.workers.dev` |
| Media | R2 (+ optional custom domain later) |
| DB | Neon or Supabase free tier |

GitHub Pages could host **only** a static marketing shell; the real app should live on Pages/Workers. When you pick a domain, point DNS at Cloudflare and keep the same Workers/R2 backend.

### 15.2 Web app vs Swift mobile app (recommendation)

**Build a responsive web app first.** Add a Swift (iOS) companion later only if you need native camera-roll UX, background upload, or App Store distribution.

| | Web (recommended v1) | Native Swift first |
|---|---|---|
| Phone upload | Yes — mobile Safari/Chrome file/camera picker → R2 | Yes — Photos framework |
| Desktop upload | Yes | Needs a separate Mac/web client |
| Public trip pages `/2026/malaysia` | Natural fit | Awkward as primary surface |
| Timeline like Google Photos | Achievable in browser | Also fine, but slower to ship |
| Backend | Same Workers + R2 + Postgres | Same — native still needs this API |
| Cost / speed to v1 | One codebase | iOS + still need web for public/desktop |
| Later native app | Call the same API | Already native; still need web for viewers |

**Why not Swift-first:** the product needs a public web surface, desktop upload, and owner timeline. A Swift-only app cannot replace that. A good mobile web upload flow covers ~20GB personal ingest without App Store review. Native becomes valuable later for: multi-select from Photos with better HEIC handling, background uploads on cellular, offline queue, widgets.

**Architecture implication:** keep a stable JSON API so a future Swift app is a new client, not a rewrite.

### 15.3 Google login vs Google Photos sync

- **Google OAuth for login:** deferred — v1 uses email auth for `rinarasia@icloud.com`.
- **Auto-download Google Photos library:** **no** (API no longer allows full-library third-party sync).
- **Bulk import path:** Google Takeout or local folders → upload into this app (optional later).
- **Ongoing ingest:** camera roll / file picker on phone and desktop in the **web** app (v1).

### 15.4 Public URL granularity

**Primary:** `/{year}/{location}` → `/2026/malaysia`  
Maps 1:1 to an album/trip row (`year` + `location_slug`).

**Optional later:** filter or deep-link by day without changing album identity, e.g. `/2026/malaysia?on=2026-03-14`. Full `/{year}/{month}/{day}/{location}` paths are possible but noisier and collide when a trip spans many days — prefer year+location as the canonical public page.

### 15.5 ~20GB library

Well within R2. Expect roughly 20GB originals + a fraction for WebP thumbs/previews. HEIC should be accepted on upload and normalized to JPEG/WebP derivatives for browser display.

---

## 16. Owner setup checklist (before coding)

Do these in the Cloudflare / DB consoles. No app code required yet.

### A. Cloudflare account (you have this)

1. **Create one R2 bucket** for all media — **not** separate `photos` and `videos` buckets.
   - Good names: `travel-archive`, `photography-media`, `rina-photos`
   - Avoid hostname-style names like `photos.digital-archive.pages.dev` (bucket names are not domains)
   - Avoid splitting by type (`photos` + later `videos`): one library, one GC/CDN/auth path; object **keys** already separate concerns (`originals/...`, `derivatives/...`, and `media.type` in the DB)
   - Rules: lowercase, digits, hyphens; keep the name stable (renaming later is painful)
   - Public site URLs come from **Pages** (`*.pages.dev`); optional later media host e.g. `media.yourdomain.com` → same bucket
2. **Create an API token** with R2 read/write for that bucket (for local/dev and Workers bindings).
3. **Note account ID** (R2 S3 endpoint uses it).
4. Optionally enable **R2 public access / custom domain** later for public derivatives only — keep originals private.
5. Plan to create (when coding starts):
   - **Worker** for API
   - **Pages** project for the web UI (this is what gets `something.pages.dev`)
   - **Queue** for thumbnail jobs (can wait until phase 2)

### B. Postgres (pick one free tier)

1. Create a project on **Neon** or **Supabase**.
2. Copy the **connection string** (pooled + direct).
3. You will not run migrations until coding starts; just have an empty DB ready.

### C. Owner identity

1. Confirm login email: **`rinarasia@icloud.com`** (seeded as sole archive owner).
2. Decide v1 auth style when we implement: **password** (simplest) or **magic link** (needs email sending via Resend/Mailgun/etc.). Recommendation: **password for v1** to avoid email-provider setup.

### D. Not needed yet

- Custom domain / DNS  
- Google Cloud OAuth client  
- Apple Developer account / Swift project  
- GitHub Pages  
- Video pipeline  

### E. Secrets you will provide when coding starts

| Secret | Source |
|---|---|
| `DATABASE_URL` | Neon/Supabase |
| R2 bucket name, account ID, access key, secret key | Cloudflare R2 |
| `SESSION_SECRET` | Generate random string |
| Owner password (or set on first login) | You choose |

---

## 17. Open points for UI phase (intentionally deferred)

- Visual design of album pages and slideshow chrome  
- Exact owner timeline grouping (by day/trip) — can be client-side from `sort_at`  
- Map view, trip entities beyond year/location albums  
- Video (MP4) upload + posters  
- Google Takeout bulk importer  
- Google OAuth login  
- Ownership transfer UI  
- Native Swift companion app  
- Custom domain cutover from `*.pages.dev`  

The data model and APIs above are sufficient to implement those later without migrating object storage.
