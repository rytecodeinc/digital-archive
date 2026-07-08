# Digital Archive

Personal travel memory archive — a private chronological photo library with curated public trip pages.

## Architecture

See **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)** for the complete system design.

### Locked product decisions

- **Client:** responsive **web app first**; optional Swift companion later (same API)
- **Upload:** phone or computer via the web app → Cloudflare R2
- **R2:** one bucket named **`media`** (photos + future videos together; not separate `photos` / `videos` buckets)
- **Auth (v1):** email login (no Google OAuth yet); owner `rinarasia@icloud.com`
- **Hosting:** Cloudflare Pages + Workers + R2 (not GitHub Pages alone)
- **v1:** photos only (JPEG/HEIC), private timeline like Google Photos
- **Public URLs (later):** `/{year}/{location}` e.g. `/2026/malaysia`

Owner setup checklist (Cloudflare R2, Postgres, secrets) is in the architecture doc §16.

Implementation has not started; this repository currently holds the architecture only.
