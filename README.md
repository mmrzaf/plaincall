# PlainCall

**A room. A code. A call.**

PlainCall is a lightweight, self-hosted browser calling app for small teams. It is optimized for fast joins, stable speech, efficient video, and a small operational surface.

PlainCall uses:

- a small Go backend with an embedded frontend;
- short stateless room codes with no database;
- opaque internal LiveKit room identifiers;
- the official LiveKit browser SDK;
- a separate official LiveKit server container as the WebRTC SFU;
- Traefik for HTTPS and WebSocket routing;
- one direct UDP media port and one TCP fallback port;
- optional embedded LiveKit TURN fallback for restrictive networks.

## Alpha 2 scope

Included:

- create a reusable `xxx-xxxx-xxx` room code;
- join by copied link or manually typed code;
- guest join by display name;
- pre-call microphone, speaker, and camera selection;
- microphone test meter and optional camera preview;
- predictable front/rear camera flipping on mobile;
- mirrored local front-camera self-view only;
- responsive count-aware participant grid for desktop and mobile;
- keyed tile updates without full-grid teardown;
- mute, camera toggle, device switching, and invite-link copy;
- voice-first, balanced, sharp-video, smooth-motion, and audio-only video modes;
- maximum-stability, balanced-speech, and clear-speech voice modes;
- text/slides and smooth-motion screen-share modes;
- adaptive stream, dynacast, simulcast, explicit speech audio, RED, and DTX;
- reconnect state and audio-playback recovery;
- optional TURN deployment overlay.

Not included:

- accounts, database, persistent room records, chat, files, recording, transcription, AI features, SIP, Redis, or multi-node LiveKit.

## Room-code model

New rooms use a short code:

```text
abc-defg-hjk
```

The share URL keeps that code in the browser fragment:

```text
https://call.example.com/join#abc-defg-hjk
```

The fragment is not part of the HTTP page request. The backend receives the code only when the browser posts the join request, then derives an opaque internal LiveKit room ID such as:

```text
pc_DXjKR27Qt9DPWz4bxtIcXXXo
```

PlainCall intentionally stores no room registry. Any syntactically valid short code resolves to a room. Codes are reusable and should be treated as convenience invitations, not strong access-control secrets. Existing Alpha 1 signed links remain accepted during migration.

## Architecture

```text
call.example.com
  ArvanCloud proxy enabled
  -> Traefik
  -> plaincall-web:8080

rtc.example.com
  ArvanCloud DNS-only
  -> Traefik
  -> plaincall-livekit:7880

server-public-ip:7882/udp
  -> plaincall-livekit media

server-public-ip:7881/tcp
  -> plaincall-livekit media fallback
```

The Go application never processes audio or video packets. LiveKit handles signaling and SFU media routing.

## Local test without Docker

Requirements:

- Go 1.23 or newer;
- Node.js 22 or newer for clean source builds;
- `livekit-server` installed locally;
- a modern browser.

Install LiveKit:

```sh
# macOS
brew install livekit

# Linux
curl -sSL https://get.livekit.io | bash
```

Start both services:

```sh
make dev
```

Open:

```text
http://localhost:8080
```

Create a room, then open the copied link in a second browser window or another device on your local network.

Run the backend API smoke test while PlainCall is running:

```sh
make smoke
```

## Development

Rebuild the frontend and Go binary:

```sh
make build
```

Run the complete verification suite:

```sh
make check
```

The verification suite runs the frontend install and production build before Go compilation so a clean checkout always generates the embedded assets.

## Production deployment

Copy the deployment template:

```sh
cd deploy
cp .env.example .env
../scripts/generate-secrets.sh
```

Paste the generated values into `deploy/.env`, set your domains, then deploy:

```sh
docker compose --env-file .env -f compose.yml up -d
```

Required DNS:

| Record | Target | ArvanCloud proxy |
|---|---|---|
| `call.example.com` | server public IP | enabled |
| `rtc.example.com` | server public IP | disabled, DNS-only |

Required firewall rules:

| Port | Protocol | Purpose |
|---|---|---|
| `443` | TCP | existing Traefik HTTPS and WebSocket traffic |
| `7881` | TCP | LiveKit ICE/TCP fallback |
| `7882` | UDP | LiveKit ICE/UDP media |

The `proxy` Docker network must already exist because it is shared with your Traefik deployment.

## Optional embedded TURN

Enable TURN only after reproducing failed joins on restrictive networks. Put a trusted certificate and key for the TURN domain in:

```text
deploy/turn-certs/tls.crt
deploy/turn-certs/tls.key
```

Set the TURN variables in `deploy/.env`, then start with the extra Compose file:

```sh
docker compose --env-file .env -f compose.yml -f compose.turn.yml up -d
```

The default optional overlay exposes TURN/UDP on `443/udp` and TURN/TLS on `5349/tcp`. For the broadest TURN/TLS compatibility, use a separate public IP or an L4 load balancer and advertise `443/tcp`; the existing Traefik HTTPS listener already occupies `443/tcp` on a single-IP deployment.

## Configuration

| Variable | Required | Default | Purpose |
|---|---:|---|---|
| `PLAINCALL_PORT` | no | `8080` | Go HTTP listener port |
| `PLAINCALL_PUBLIC_URL` | yes in production | — | public web URL |
| `LIVEKIT_PUBLIC_URL` | yes in production | — | public LiveKit WebSocket URL |
| `LIVEKIT_API_KEY` | yes in production | — | shared LiveKit API key |
| `LIVEKIT_API_SECRET` | yes in production | — | shared LiveKit API secret |
| `PLAINCALL_SECRET_KEY` | yes in production | — | HMAC key used to derive opaque internal room IDs and verify legacy links |
| `PLAINCALL_ROOM_TTL` | no | `24h` | Alpha 1 legacy signed-link lifetime only |
| `PLAINCALL_TOKEN_TTL` | no | `30m` | initial LiveKit join-token lifetime |
| `PLAINCALL_TRUST_PROXY_HEADERS` | no | `false` | trust Traefik forwarding headers |
| `PLAINCALL_ALLOWED_ORIGINS` | no | public URL | comma-separated additional allowed origins |
| `PLAINCALL_DEV` | no | `false` | use local development defaults |
| `LIVEKIT_TURN_ENABLED` | no | `false` | enable embedded LiveKit TURN server |
| `PLAINCALL_TURN_DOMAIN` | TURN only | `turn.example.com` | domain matching the TURN TLS certificate |
| `LIVEKIT_TURN_UDP_PORT` | no | `443` | advertised TURN/UDP port |
| `LIVEKIT_TURN_TLS_PORT` | no | `5349` | advertised TURN/TLS port |

## Documentation

- [`docs/PROJECT.md`](docs/PROJECT.md): product boundary and architecture decisions.
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md): production deployment and troubleshooting.
- [`docs/TESTING.md`](docs/TESTING.md): test matrix and release gate.
- [`BUILD_REPORT.md`](BUILD_REPORT.md): release-candidate verification report.
- [`ALPHA2_RELEASE_CANDIDATE.md`](ALPHA2_RELEASE_CANDIDATE.md): final cleanup overlay notes.

## License

MIT
