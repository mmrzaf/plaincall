#!/bin/sh
# Prints fresh credentials for deploy/.env.
# Usage: scripts/generate-secrets.sh [member-label]
set -eu

label="${1:-team}"
echo "LIVEKIT_API_KEY=API$(openssl rand -hex 6)"
echo "LIVEKIT_API_SECRET=$(openssl rand -hex 32)"
echo "PLAINCALL_KEYS=${label}:$(openssl rand -hex 16)"
