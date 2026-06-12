#!/usr/bin/env sh
set -eu

hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$1"
    return
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$1" <<'PY'
import secrets, sys
print(secrets.token_hex(int(sys.argv[1])))
PY
    return
  fi
  echo "openssl or python3 is required" >&2
  exit 1
}

cat <<EOF_OUT
LIVEKIT_API_KEY=$(hex 12)
LIVEKIT_API_SECRET=$(hex 32)
PLAINCALL_SECRET_KEY=$(hex 32)
EOF_OUT
