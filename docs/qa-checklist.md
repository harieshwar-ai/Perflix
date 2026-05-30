# Perflix QA Checklist

Manual acceptance tests after Phase 12. Run against dev (`npm run dev` → http://localhost:5173) or production (`npm run build && npm start` → http://127.0.0.1:7000).

## Environment

- [ ] `.env` filled: `LIBRARY_ROOT`, `TMDB_ACCESS_TOKEN`, `SESSION_SECRET`, `SIGNING_SECRET`
- [ ] FFmpeg available: `ffmpeg -version` and `ffprobe -version`
- [ ] Library has at least one direct-play MP4 and one HEVC/MKV title

## Auth & security

- [ ] First visit → passkey registration succeeds
- [ ] Second browser without passkey → redirected to login; `/api/library` returns 401
- [ ] Signed media URL tampered → 403
- [ ] `/stream/:id` without session → 401

## Library & UI

- [ ] Home loads with hero, rows, Continue Watching (if progress exists)
- [ ] Hover tile ~0.6s → scale-up + muted preview clip
- [ ] Browse Movies/Series filters and sort work
- [ ] Detail page: play, resume, watchlist toggle, episode list (series)
- [ ] Page transitions feel smooth (no flash of white)
- [ ] Mobile layout: nav collapses; tiles scroll horizontally

## Playback

- [ ] MP4 H.264 direct play starts &lt; 1s; scrubbing instant
- [ ] HEVC MKV transcode/remux starts &lt; 3s; audio in sync
- [ ] Resume: close mid-play → reopen within ~1s of last position
- [ ] Keyboard: space, arrows ±5s, j/l ±10s, m mute, f fullscreen, esc back
- [ ] Quality menu switches ladder rungs (transcode titles)
- [ ] Speed menu: 0.5×–2× works
- [ ] Controls auto-hide after ~2.5s idle; reappear on mouse/touch

## Subtitles

- [ ] Local sidecar `.srt` appears in picker
- [ ] OpenSubtitles search + download renders soft subs

## Lists

- [ ] Add to My List → appears on `/lists` immediately and after refresh
- [ ] Watched / watching derived from progress (≥95% = watched)

## AirPlay (Safari only)

- [ ] iPhone/iPad Safari → AirPlay icon → Apple TV continues playback

## Remote access (production)

- [ ] Cloudflare Tunnel up → `https://perflix.<domain>` loads
- [ ] Passkey works on tunneled HTTPS origin (`PUBLIC_URL` + `RP_ID` match domain)
- [ ] Cellular/off-LAN playback works

## Performance

- [ ] Lighthouse mobile score ≥ 90 on home (production build, throttled)
- [ ] Cold load TTI &lt; 1.5s on home
- [ ] `npm run analyze` → review `apps/web/dist/stats.html` bundle splits
- [ ] Memory stable after 30 min playback (&lt; 300 MB tab)

## Attribution

- [ ] TMDb footer visible on authenticated pages
