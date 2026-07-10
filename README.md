# Digital Archive

My personal digital archive — private chronological photo library with curated public trip pages (later).

## Phase 1 (implemented)

- Email/password owner login (`rinarasia@icloud.com`)
- Direct photo upload from phone/computer → Cloudflare R2 bucket `digital-archive-media`
- Private timeline (newest first)
- Soft-delete

## Docs

- [Architecture](./docs/ARCHITECTURE.md)
- [Setup](./docs/SETUP.md) — **read this before running** (needs Supabase Postgres URI)

## Quick start

```bash
cp .env.example .env
cp apps/api/.dev.vars.example apps/api/.dev.vars
# fill DATABASE_URL (Postgres URI), R2 keys, SESSION_SECRET, OWNER_PASSWORD

npm install
npm run db:migrate
npm run db:seed
npm run dev:api
npm run dev:web
```

Open `http://127.0.0.1:5173`, sign in, upload photos.

## Monorepo

```
apps/api     Cloudflare Worker (Hono)
apps/web     Vite + React owner UI
packages/db  SQL migrations
scripts/     migrate + seed
```
