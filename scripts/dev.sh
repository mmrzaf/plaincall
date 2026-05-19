#!/usr/bin/env bash
# Runs everything needed for local development: a LiveKit server in dev mode,
# the Go server, and the Vite dev server with hot reload.
#
# Needs livekit-server on PATH (https://docs.livekit.io/home/self-hosting/local/),
# Go, and Node. Open http://localhost:5173 and join with the key printed below.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v livekit-server >/dev/null 2>&1; then
  echo "livekit-server was not found on PATH." >&2
  echo "Install it from https://docs.livekit.io/home/self-hosting/local/ and try again." >&2
  exit 1
fi

export PLAINCALL_ADDR="127.0.0.1:8080"
export PLAINCALL_KEYS="dev:devdevdevdevdevdev"
export LIVEKIT_URL="ws://localhost:7880"
export LIVEKIT_API_KEY="devkey"
export LIVEKIT_API_SECRET="secret"

pids=()
cleanup() {
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT INT TERM

livekit-server --dev --bind 127.0.0.1 >/dev/null 2>&1 &
pids+=($!)

go run ./cmd/plaincall &
pids+=($!)

echo
echo "Host key for local testing: devdevdevdevdevdev"
echo "Open http://localhost:5173"
echo

(cd web && npm run dev)
