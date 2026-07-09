# Phase 1 setup

## What you already have

| Item | Value |
|---|---|
| R2 bucket | `digital-archive-media` |
| Cloudflare Account ID | `75d07e9024b11886801cce0718edc814` |
| Owner email | `rinarasia@icloud.com` |
| App login password | set by you (seeded into DB) |
| Supabase project URL | `https://sqtdpkvzeyckerxqfeic.supabase.co` |

## Still required: Postgres URI

The project URL above is **not** a Postgres connection string.

1. Open Supabase → your project → **Connect** (or Project Settings → Database).
2. Copy the **Session pooler** URI (port `5432`), which looks like:

```text
postgresql://postgres.sqtdpkvzeyckerxqfeic:[YOUR-DB-PASSWORD]@aws-1-us-west-2.pooler.supabase.com:5432/postgres
```

3. `[YOUR-DB-PASSWORD]` is the **database password** chosen when the Supabase project was created — it is separate from the app login password (`Admin8712!`).

If you forgot the DB password: Database Settings → reset database password, then use the new value in `DATABASE_URL`.

## Local env files

Create `/workspace/.env` (gitignored):

```bash
OWNER_EMAIL=rinarasia@icloud.com
OWNER_PASSWORD=Admin8712!
DATABASE_URL=postgresql://postgres.sqtdpkvzeyckerxqfeic:DB_PASSWORD@aws-1-us-west-2.pooler.supabase.com:5432/postgres
CF_ACCOUNT_ID=75d07e9024b11886801cce0718edc814
R2_BUCKET=digital-archive-media
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
SESSION_SECRET=...long-random...
```

Create `apps/api/.dev.vars` with the same `DATABASE_URL`, R2 keys, and `SESSION_SECRET` for `wrangler dev`.

## Commands

```bash
npm install
npm run db:migrate
npm run db:seed
npm run dev:api    # http://127.0.0.1:8787
npm run dev:web    # http://127.0.0.1:5173
```

Open the web app, sign in as `rinarasia@icloud.com`, upload photos.

## Phase 1 scope

- Email/password owner login
- Direct upload to R2 (`digital-archive-media`)
- Private chronological timeline
- Soft-delete

Not in Phase 1: thumbnails worker, albums/public trip pages, video, ownership transfer.
