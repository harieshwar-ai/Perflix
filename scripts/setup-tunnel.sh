#!/usr/bin/env bash
set -euo pipefail

# Sets up a named Cloudflare Tunnel that fronts the local Perflix server on :7000.
# Requires: a Cloudflare account, a domain you own added to that account.

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

c_info(){ printf "\033[36m→\033[0m %s\n" "$*"; }
c_ok()  { printf "\033[32m✓\033[0m %s\n" "$*"; }
c_err() { printf "\033[31m✗\033[0m %s\n" "$*" >&2; }

if ! command -v cloudflared >/dev/null 2>&1; then
  c_info "Installing cloudflared via Homebrew…"
  brew install cloudflared
fi
c_ok "cloudflared $(cloudflared --version 2>&1 | head -1)"

# Login (browser-based)
if [ ! -f "$HOME/.cloudflared/cert.pem" ]; then
  c_info "Logging in to Cloudflare (browser will open)…"
  cloudflared tunnel login
else
  c_ok "already logged in (~/.cloudflared/cert.pem present)"
fi

TUNNEL_NAME="perflix"

# Create tunnel if not present
if cloudflared tunnel list 2>/dev/null | awk '{print $2}' | grep -qx "$TUNNEL_NAME"; then
  c_ok "tunnel '$TUNNEL_NAME' already exists"
else
  c_info "Creating tunnel '$TUNNEL_NAME'…"
  cloudflared tunnel create "$TUNNEL_NAME"
fi

TUNNEL_UUID=$(cloudflared tunnel list 2>/dev/null | awk -v n="$TUNNEL_NAME" '$2==n {print $1; exit}')
if [ -z "$TUNNEL_UUID" ]; then c_err "could not resolve tunnel UUID"; exit 1; fi
c_ok "tunnel UUID: $TUNNEL_UUID"

# Hostname
if [ -z "${PERFLIX_HOSTNAME:-}" ]; then
  printf "Hostname for Perflix (e.g., perflix.example.com): "
  read -r PERFLIX_HOSTNAME
fi
[ -n "$PERFLIX_HOSTNAME" ] || { c_err "hostname is required"; exit 1; }

# Config
mkdir -p "$HOME/.cloudflared"
CFG="$HOME/.cloudflared/config.yml"
cat > "$CFG" <<EOF
tunnel: $TUNNEL_UUID
credentials-file: $HOME/.cloudflared/$TUNNEL_UUID.json
originRequest:
  noTLSVerify: true
ingress:
  - hostname: $PERFLIX_HOSTNAME
    service: http://127.0.0.1:7000
  - service: http_status:404
EOF
c_ok "wrote $CFG"

# Route DNS
c_info "Routing $PERFLIX_HOSTNAME -> tunnel"
cloudflared tunnel route dns "$TUNNEL_NAME" "$PERFLIX_HOSTNAME" || true

# LaunchAgent
LA_DIR="$HOME/Library/LaunchAgents"
mkdir -p "$LA_DIR"
mkdir -p "$REPO_DIR/.perflix/logs"
TUNNEL_PLIST="$LA_DIR/com.perflix.tunnel.plist"
CFLARED=$(command -v cloudflared)

cat > "$TUNNEL_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.perflix.tunnel</string>
  <key>ProgramArguments</key>
  <array>
    <string>$CFLARED</string>
    <string>tunnel</string>
    <string>--config</string>
    <string>$CFG</string>
    <string>run</string>
    <string>$TUNNEL_NAME</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$REPO_DIR/.perflix/logs/tunnel.out.log</string>
  <key>StandardErrorPath</key><string>$REPO_DIR/.perflix/logs/tunnel.err.log</string>
</dict>
</plist>
EOF
c_ok "wrote $TUNNEL_PLIST"

launchctl unload "$TUNNEL_PLIST" 2>/dev/null || true
launchctl load -w "$TUNNEL_PLIST"
c_ok "tunnel LaunchAgent loaded"

cat <<EOF

Tunnel is now serving:
  https://$PERFLIX_HOSTNAME -> http://127.0.0.1:7000

Update your .env:
  PUBLIC_URL=https://$PERFLIX_HOSTNAME
  RP_ID=${PERFLIX_HOSTNAME#*.}

Then restart the server:
  launchctl unload ~/Library/LaunchAgents/com.perflix.server.plist
  launchctl load   ~/Library/LaunchAgents/com.perflix.server.plist

Logs:
  tail -f .perflix/logs/tunnel.out.log

EOF
