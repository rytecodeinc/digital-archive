# Photography

Personal travel memory archive — a private chronological photo library with curated public trip pages.

## Architecture

See **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)** for the complete system design.

### Locked product decisions

- **Upload:** directly from phone or computer in the web app (not Google Photos auto-sync)
- **Hosting:** Cloudflare Pages + Workers + R2 (GitHub Pages alone cannot run the API/storage)
- **Owner:** single transferable archive owner (Google OAuth login)
- **v1:** photos only (JPEG/HEIC), private timeline like Google Photos
- **Public URLs (later):** `/{year}/{location}` e.g. `/2026/malaysia`

Implementation has not started; this repository currently holds the architecture only.
