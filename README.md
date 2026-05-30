# Perflix

A personal, single-user video streaming service. Looks polished, runs locally, reachable from anywhere via Cloudflare Tunnel, secured with passkeys, zero recurring cost.

## Stack

- **Server:** Node 20+ · Fastify 5 · better-sqlite3 · FFmpeg (VideoToolbox HW accel) · SimpleWebAuthn · iron-session
- **Web:** Vite · React 18 · TypeScript · Tailwind 4 · TanStack Router/Query · Framer Motion · hls.js · Zustand
- **Infra:** Cloudflare Tunnel (free) · TMDb v3 (free) · OpenSubtitles v1 (free) · macOS launchd

## Quick start

```bash
brew install ffmpeg cloudflared
cp .env.example .env
# fill in LIBRARY_ROOT, TMDB_API_KEY, OPENSUBS_API_KEY,
# and generate SESSION_SECRET / SIGNING_SECRET with `openssl rand -hex 32`
npm install
npm run dev
```

Open <http://localhost:5173>.

## Production

After `npm run build`, point a named Cloudflare Tunnel at `http://127.0.0.1:7000` and CNAME a subdomain of your domain to it. See `scripts/setup-tunnel.sh` (added in phase 11).

## Status

Under active build. See `/Users/harieshwar-ai/.claude/plans/linked-juggling-micali.md` for the phased implementation plan.
