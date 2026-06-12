# PlainCall

**A room. A link. A call.**

PlainCall is a lightweight, self-hosted browser calling app for small teams. It is optimized for fast joins, stable audio, efficient video, and a small operational surface.

PlainCall uses:

- a small Go backend with an embedded frontend;
- signed, time-limited room links with no database;
- the official LiveKit browser SDK;
- a separate official LiveKit server container as the WebRTC SFU;
- Traefik for HTTPS and WebSocket routing;
- one direct UDP media port and one TCP fallback port.

## v0.1 scope

Included:

- ephemeral room links;
- guest join by display name;
- pre-call microphone, speaker, and camera selection;
- microphone test meter and optional camera preview;
- audio, video, and screen sharing;
- mute, camera toggle, device switching, and invite-link copy;
- participant grid, active-speaker highlighting, and connection-quality labels;
- reconnect state and audio-playback recovery;
- responsive desktop and mobile layout.

Not included:

- accounts, database, chat, files, recording, transcription, AI features, SIP, Redis, multi-node LiveKit, or TURN.

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

The repository includes a prebuilt embedded frontend, so Node.js is not required just to run the app locally. Node.js is required only when modifying frontend code.

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

The verification suite runs:

```text
gofmt check
go test ./...
go vet ./...
npm ci
TypeScript type-check
Vite production build
Go production build
```

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

## Configuration

| Variable | Required | Default | Purpose |
|---|---:|---|---|
| `PLAINCALL_PORT` | no | `8080` | Go HTTP listener port |
| `PLAINCALL_PUBLIC_URL` | yes in production | — | public web URL |
| `LIVEKIT_PUBLIC_URL` | yes in production | — | public LiveKit WebSocket URL |
| `LIVEKIT_API_KEY` | yes in production | — | shared LiveKit API key |
| `LIVEKIT_API_SECRET` | yes in production | — | shared LiveKit API secret |
| `PLAINCALL_SECRET_KEY` | yes in production | — | HMAC key for signed room links |
| `PLAINCALL_ROOM_TTL` | no | `24h` | room-link lifetime |
| `PLAINCALL_TOKEN_TTL` | no | `30m` | initial LiveKit join-token lifetime |
| `PLAINCALL_TRUST_PROXY_HEADERS` | no | `false` | trust Traefik forwarding headers |
| `PLAINCALL_ALLOWED_ORIGINS` | no | public URL | comma-separated additional allowed origins |
| `PLAINCALL_DEV` | no | `false` | use local development defaults |

## Documentation

- [`docs/PROJECT.md`](docs/PROJECT.md): product boundary and architecture decisions.
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md): production deployment and troubleshooting.
- [`docs/TESTING.md`](docs/TESTING.md): test matrix and release gate.

## License

MIT
