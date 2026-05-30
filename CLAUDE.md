# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Perflix is a personal, single-user video streaming service. It serves a local video library (on an external SSD or local disk) via a polished web app reachable over the public internet through a Cloudflare Tunnel, secured with WebAuthn passkeys.

**Goal:** commercial-streaming-grade UX, zero recurring cost, no third-party telemetry, hardware-accelerated transcoding on macOS.

## Architecture

Monorepo via npm workspaces:

- `apps/server` — Fastify 5 + better-sqlite3 + FFmpeg (VideoToolbox). Library scanner, HLS on-demand pipeline, auth, subtitle service.
- `apps/web` — Vite + React 18 + TypeScript + Tailwind 4 + TanStack Router/Query + Framer Motion + hls.js. SPA client.

Originals are never re-encoded. The server picks the cheapest playback path per file:

1. **Direct play** — mp4/h264/aac → HTTP Range, raw bytes.
2. **Remux** — incompatible container, compatible codecs → ffmpeg `-c copy` to HLS.
3. **Transcode** — incompatible codecs → VideoToolbox HW encode to H.264+AAC HLS.

See the implementation plan at `/Users/harieshwar-ai/.claude/plans/linked-juggling-micali.md` for full architecture and phase breakdown.

## Getting Started

Prereqs: Node 20+, npm 10+, FFmpeg (`brew install ffmpeg`).

```bash
cp .env.example .env       # fill in TMDB_ACCESS_TOKEN, OPENSUBS_API_KEY, secrets, LIBRARY_ROOT
npm install
npm run dev                # server on :7000, web on :5173
```

Open http://localhost:5173 for dev. Production: `npm run build && npm start` → http://127.0.0.1:7000.

## Commands

- `npm run dev` — runs server (Fastify w/ tsx watch) and web (Vite) concurrently.
- `npm run build` — typechecks + builds both packages for production.
- `npm run typecheck` — TS check across both workspaces.
- `npm run format` — Prettier across `apps/*/src`.
- `npm run analyze` — web bundle analysis → `apps/web/dist/stats.html`.
- `npm run -w @perflix/server dev` — server only.
- `npm run -w @perflix/web dev` — web only.

## Secrets

Generate session and signing secrets with:

```bash
openssl rand -hex 32
```

Required env vars are documented in `.env.example`. The server fails fast at boot if required values for the current phase are missing.

## Library Layout (expected on disk)

```
LIBRARY_ROOT/
├── Movies/
│   ├── Inception (2010)/Inception.mkv
│   └── ...
└── Series/
    └── Breaking Bad/
        └── Season 01/Breaking Bad - S01E01 - Pilot.mkv
```

Folder shape determines Movie vs Series. Filenames are parsed by `parse-torrent-title` for title/year/season/episode.

## Security Posture

- Bind to `127.0.0.1` only. The Cloudflare Tunnel daemon is the only ingress.
- Passkey-only auth (max 4 credentials = device cap).
- Signed media URLs (HMAC, short TTL, bound to session).
- Strict CSP, helmet, rate limiting.
- Path traversal protection: every fs path must resolve under `LIBRARY_ROOT`.
