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
URL=$(printf '%s' "$ROOM_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["url"])')
printf 'Room code: %s\n' "$ROOM"
printf 'Invite URL: %s\n' "$URL"

printf 'Issuing participant token ...\n'
TOKEN_JSON=$(curl -fsS \
  -X POST \
  -H "Origin: $ORIGIN" \
  -H 'Content-Type: application/json' \
  --data "{\"room_code\":\"$ROOM\",\"participant_name\":\"Smoke Test\"}" \
  "$BASE_URL/api/token")

python3 - "$ROOM" "$TOKEN_JSON" <<'PY'
import base64
import json
import sys

room_code = sys.argv[1]
payload = json.loads(sys.argv[2])
assert payload["server_url"]
token = payload["participant_token"]
assert token.count(".") == 2
encoded = token.split(".")[1]
encoded += "=" * (-len(encoded) % 4)
claims = json.loads(base64.urlsafe_b64decode(encoded))
livekit_room = claims["video"]["room"]
assert livekit_room.startswith("pc_")
assert room_code not in livekit_room
print("Smoke test passed.")
PY
