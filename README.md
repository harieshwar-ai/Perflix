# Perflix

A personal, single-user video streaming service. Polished UI, runs locally, reachable from anywhere via Cloudflare Tunnel, secured with passkeys, zero recurring software cost.

## Stack

- **Server:** Node 20+ · Fastify 5 · better-sqlite3 · FFmpeg (VideoToolbox HW accel) · SimpleWebAuthn · iron-session
- **Web:** Vite · React 19 · TypeScript · Tailwind 4 · TanStack Router/Query · Framer Motion · hls.js
- **Infra:** Cloudflare Tunnel (free) · TMDb (free) · OpenSubtitles v1 (free) · macOS launchd

## Quick start

```bash
brew install ffmpeg cloudflared
cp .env.example .env
# fill in LIBRARY_ROOT, TMDB_ACCESS_TOKEN, OPENSUBS_API_KEY,
# and generate SESSION_SECRET / SIGNING_SECRET with `openssl rand -hex 32`
npm install
npm run dev
```

Open **http://localhost:5173** (Vite proxies API to the server on **127.0.0.1:7000**).

## Production

```bash
npm run build
npm start   # serves SPA + API on http://127.0.0.1:7000
```

Point a named Cloudflare Tunnel at `http://127.0.0.1:7000`. See `scripts/setup-tunnel.sh` and `scripts/install.sh`.

## Useful commands

| Command | Description |
|---|---|
| `npm run dev` | Server `:7000` + web `:5173` |
| `npm run build` | Production build (web → `apps/web/dist`, server → `apps/server/dist`) |
| `npm start` | Run production server |
| `npm run typecheck` | TypeScript across both packages |
| `npm run analyze` | Build web + emit bundle report at `apps/web/dist/stats.html` |
| `npm run format` | Prettier |

## Library layout

```
LIBRARY_ROOT/
├── Movies/
│   └── Inception (2010)/Inception.mkv
└── TV/   (or Series/Shows)
    └── Breaking Bad/
        └── Season 01/Breaking Bad - S01E01 - Pilot.mkv
```

## Status

**Phase 12 complete** — performance pass, animation polish, CSP, TMDb attribution, QA checklist. Ready for day-one personal use.

See `docs/qa-checklist.md` for manual acceptance tests.
