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

## Cloudflare Workers Builds (API)

This is a monorepo. The Worker entrypoint is `apps/api/src/index.ts`.

If Workers Builds runs from the **repo root**, keep the root `wrangler.toml` (already in the repo) and use:

| Setting | Value |
|---|---|
| Root directory | `/` (repo root) |
| Install command | `npm clean-install --progress=false` (default is fine) |
| Build command | _(leave empty)_ |
| Deploy command | `npx wrangler versions upload` |

Alternatively, set **Root directory** to `apps/api` and keep deploy as `npx wrangler versions upload` (uses `apps/api/wrangler.toml`).

Set Worker secrets once (from a logged-in machine):

```bash
cd apps/api
npx wrangler secret put DATABASE_URL
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
npx wrangler secret put SESSION_SECRET
```

## Cloudflare Pages (web UI)

Build settings for the React app:

| Setting | Value |
|---|---|
| Root directory | `/` (repo root) |
| Framework preset | Vite |
| Build command | `npm run build -w @digital-archive/web` |
| Build output directory | `apps/web/dist` |
| Production branch | your deploy branch (e.g. `main` or `cursor/phase1-archive-app-94d0`) |

**Do not** put `DATABASE_URL` / R2 / `SESSION_SECRET` on Pages. Those belong on the Worker.

### API proxy (required for login)

The UI calls relative `/api/...` paths. Repo root `functions/api/[[path]].ts` proxies those to:

`https://digital-archive.rytecode.workers.dev`

After pushing, wait for Pages to redeploy, then hard-refresh `https://digital-archive-1lq.pages.dev` and try login again.

Confirm Worker health first:

`https://digital-archive.rytecode.workers.dev/api/health`

### Pages → API (current production setup)

Production builds default `VITE_API_BASE_URL` to `https://digital-archive.rytecode.workers.dev` so the UI talks to the Worker even when the Pages `/api` Function is inactive (405).

Optional override (Pages → Settings → Environment variables, then rebuild):

| Pages env var | Value |
|---|---|
| `VITE_API_BASE_URL` | `https://digital-archive.rytecode.workers.dev` |

Login cookies use `SameSite=None; Secure` when the request `Origin` is cross-site (Pages → Worker).

### Worker database (required for login)

Direct `DATABASE_URL` from a Worker often fails with **Too many subrequests** on the free plan. Use **Cloudflare Hyperdrive** (dashboard, no CLI):

1. Supabase → **Project Settings** → **Database** → **Connection string** → **Direct connection**  
   (Hyperdrive wants the direct host `db.<project>.supabase.co`, not the pooler.)
2. Cloudflare dashboard → **Hyperdrive** → **Create configuration**
3. Name it e.g. `digital-archive-supabase`, paste the Direct connection string, create
4. Copy the Hyperdrive **ID**
5. Cloudflare → **Workers & Pages** → Worker **`digital-archive`** → **Settings** → **Bindings** → **Add** → **Hyperdrive**
   - Variable name: `HYPERDRIVE`
   - Hyperdrive config: the one you just created
6. Save / deploy if prompted
7. Check: `https://digital-archive.rytecode.workers.dev/api/health?db=1`  
   Expect `"database":"ok"` and `"hyperdrive":true`

Optional fallback (local / without Hyperdrive): Worker secret `DATABASE_URL` using the Supabase **Session pooler** URI (`aws-…pooler.supabase.com:5432`).


