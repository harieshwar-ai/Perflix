#!/usr/bin/env bash
set -euo pipefail

# Perflix installer. Idempotent — safe to re-run.

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

c_dim() { printf "\033[2m%s\033[0m\n" "$*"; }
c_ok()  { printf "\033[32m✓\033[0m %s\n" "$*"; }
c_info(){ printf "\033[36m→\033[0m %s\n" "$*"; }
c_err() { printf "\033[31m✗\033[0m %s\n" "$*" >&2; }

c_info "Perflix install — $(date '+%Y-%m-%d %H:%M:%S')"
c_dim  "Repo: $REPO_DIR"

# --- prerequisites ---
if ! command -v brew >/dev/null 2>&1; then
  c_err "Homebrew is required. Install from https://brew.sh first."
  exit 1
fi

for bin in node npm ffmpeg ffprobe; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    c_info "Installing $bin via Homebrew…"
    case "$bin" in
      node|npm) brew install node ;;
      ffmpeg|ffprobe) brew install ffmpeg ;;
    esac
  fi
done
c_ok "prerequisites present"

# --- env ---
if [ ! -f .env ]; then
  c_info "Creating .env from template — fill in secrets before first run"
  cp .env.example .env
  # generate secrets if openssl is available
  if command -v openssl >/dev/null 2>&1; then
    SESSION=$(openssl rand -hex 32)
    SIGNING=$(openssl rand -hex 32)
    /usr/bin/sed -i '' "s/^SESSION_SECRET=$/SESSION_SECRET=$SESSION/" .env
    /usr/bin/sed -i '' "s/^SIGNING_SECRET=$/SIGNING_SECRET=$SIGNING/" .env
    c_ok "generated SESSION_SECRET and SIGNING_SECRET into .env"
  fi
  c_info "Edit .env to set LIBRARY_ROOT, TMDB_ACCESS_TOKEN, OPENSUBS_API_KEY, PUBLIC_URL, RP_ID"
fi

# --- deps + build ---
c_info "Installing npm dependencies…"
npm install --silent
c_ok "npm install"

c_info "Building production bundles…"
npm run build
c_ok "build"

# --- LaunchAgents ---
LA_DIR="$HOME/Library/LaunchAgents"
mkdir -p "$LA_DIR"
mkdir -p "$REPO_DIR/.perflix/logs"

NODE_BIN="$(command -v node)"
SERVER_PLIST="$LA_DIR/com.perflix.server.plist"

cat > "$SERVER_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.perflix.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$REPO_DIR/apps/server/dist/index.js</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$REPO_DIR/.perflix/logs/server.out.log</string>
  <key>StandardErrorPath</key><string>$REPO_DIR/.perflix/logs/server.err.log</string>
</dict>
</plist>
EOF
c_ok "wrote $SERVER_PLIST"

c_info "Reloading LaunchAgent (you may need to grant Full Disk Access to Terminal/iTerm)"
launchctl unload "$SERVER_PLIST" 2>/dev/null || true
launchctl load -w "$SERVER_PLIST"
c_ok "server LaunchAgent loaded"

cat <<'NEXT'

Next steps:
  1. Verify the server is running:   curl http://127.0.0.1:7000/health
  2. Set up the Cloudflare Tunnel:   ./scripts/setup-tunnel.sh
  3. Open the UI in a browser:       open http://localhost:7000

Logs:
  tail -f .perflix/logs/server.out.log .perflix/logs/server.err.log

NEXT
