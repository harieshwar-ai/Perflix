#!/usr/bin/env bash
# Clear Perflix app data (DB library state + on-disk caches) but keep WebAuthn credentials.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$REPO_DIR/.perflix"
DB="$DATA/perflix.db"

if [[ ! -f "$DB" ]]; then
  echo "No database at $DB — nothing to reset."
  exit 0
fi

echo "Stopping active ffmpeg transcodes (if any)…"
pkill -f 'ffmpeg.*hls-cache' 2>/dev/null || true

echo "Clearing library tables (keeping users + passkeys)…"
sqlite3 "$DB" <<'SQL'
PRAGMA foreign_keys = ON;
DELETE FROM subtitles;
DELETE FROM progress;
DELETE FROM lists;
DELETE FROM files;
DELETE FROM episodes;
DELETE FROM titles;
SQL

echo "Checkpointing database…"
sqlite3 "$DB" 'PRAGMA wal_checkpoint(TRUNCATE);'

echo "Removing generated caches…"
for dir in art hls-cache preview thumbs subs tmdb; do
  if [[ -d "$DATA/$dir" ]]; then
    rm -rf "$DATA/$dir"
    mkdir -p "$DATA/$dir"
    echo "  cleared $dir/"
  fi
done

USERS=$(sqlite3 "$DB" 'SELECT COUNT(*) FROM users;')
CREDS=$(sqlite3 "$DB" 'SELECT COUNT(*) FROM credentials;')
echo ""
echo "Done. Preserved $USERS user(s) and $CREDS passkey credential(s)."
echo "Restart the server (npm run dev) to rescan LIBRARY_ROOT and rebuild metadata."
