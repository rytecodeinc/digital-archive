# Photography

Personal travel memory archive — a private chronological photo/video library with curated public albums.

## Architecture

See **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)** for the complete system design:

- Archive timeline vs curated albums (no file duplication)
- Cloudflare R2 media storage strategy
- Database schema (Postgres)
- API structure optimized for minimal backend calls
- Owner vs viewer permissions and user flows
- Scaling notes for millions of media items

Implementation has not started; this repository currently holds the architecture only.
