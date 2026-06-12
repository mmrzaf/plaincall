#!/usr/bin/env sh
set -eu

BASE_URL="${PLAINCALL_BASE_URL:-http://localhost:8080}"
ORIGIN="${PLAINCALL_ORIGIN:-$BASE_URL}"

printf 'Checking %s/health ...\n' "$BASE_URL"
curl -fsS "$BASE_URL/health" >/dev/null

printf 'Creating room ...\n'
ROOM_JSON=$(curl -fsS \
  -X POST \
  -H "Origin: $ORIGIN" \
  -H 'Content-Type: application/json' \
  --data '{}' \
  "$BASE_URL/api/rooms")

ROOM=$(printf '%s' "$ROOM_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["room"])')

printf 'Issuing participant token ...\n'
TOKEN_JSON=$(curl -fsS \
  -X POST \
  -H "Origin: $ORIGIN" \
  -H 'Content-Type: application/json' \
  --data "{\"room_name\":\"$ROOM\",\"participant_name\":\"Smoke Test\"}" \
  "$BASE_URL/api/token")

printf '%s' "$TOKEN_JSON" | python3 -c '
import json,sys
payload=json.load(sys.stdin)
assert payload["server_url"]
assert payload["participant_token"].count(".") == 2
print("Smoke test passed.")
'
