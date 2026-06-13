#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

if ! command -v livekit-server >/dev/null 2>&1; then
  cat >&2 <<'EOF_HELP'
livekit-server is required for local calls.

Install it first:
  macOS:  brew install livekit
  Linux:  curl -sSL https://get.livekit.io | bash

Then run: make dev
EOF_HELP
  exit 1
fi

PORT="${PLAINCALL_PORT:-8080}"
LOG_FILE="${TMPDIR:-/tmp}/plaincall-livekit.log"
livekit-server --dev >"$LOG_FILE" 2>&1 &
LIVEKIT_PID=$!

cleanup() {
  kill "$LIVEKIT_PID" 2>/dev/null || true
  wait "$LIVEKIT_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

printf 'LiveKit dev server started. Log: %s\n' "$LOG_FILE"
printf 'PlainCall: http://localhost:%s\n' "$PORT"
PLAINCALL_DEV=true PLAINCALL_PORT="$PORT" go run ./cmd/plaincall
