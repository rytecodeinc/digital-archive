# Phase 1 setup

## What you already have

| Item | Value |
|---|---|
| R2 bucket | `digital-archive-media` |
| Cloudflare Account ID | `75d07e9024b11886801cce0718edc814` |
| Owner email | `rinarasia@icloud.com` |
| App login password | set by you (seeded into DB) |
| Supabase project URL | `https://sqtdpkvzeyckerxqfeic.supabase.co` |

## Postgres URI

Supabase’s “direct” URI (`db.<ref>.supabase.co`) is often **IPv6-only**. This environment (and many serverless hosts) need the **Session pooler** instead:

```text
postgresql://postgres.sqtdpkvzeyckerxqfeic:[DB-PASSWORD]@aws-1-us-west-2.pooler.supabase.com:5432/postgres
```

Notes:

- URL-encode special characters in the password (`!` → `%21`).
- DB password ≠ app login password.
- Project API host `https://….supabase.co` is not a Postgres URI.

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
npm run dev:api    # Node local API on http://127.0.0.1:8787
npm run dev:web    # http://127.0.0.1:5173
```

`npm run dev:api` uses a Node server so local Postgres TLS works in restricted networks.
Production still deploys with `npm run deploy -w @digital-archive/api` (Cloudflare Worker).
Optional: `npm run dev:worker -w @digital-archive/api` for wrangler-local Worker runtime.

Open the web app, sign in as `rinarasia@icloud.com`, upload photos.

## R2 CORS (for direct browser uploads later)

The app currently uploads via a **same-origin API proxy** (`PUT /api/owner/media/:id/content`) so the browser does not need R2 CORS.

When you want direct-to-R2 uploads (better for large files), set bucket CORS in Cloudflare → R2 → `digital-archive-media` → Settings → CORS policy:

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Replace `*` with your real site origin once you have a stable domain. Your current Object Read & Write token cannot change CORS; use the dashboard or an Admin token.
