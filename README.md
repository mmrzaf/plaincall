# PlainCall

Simple, self-hosted video calls. Pick a room name, share the link, talk.

- **No accounts, no database.** Rooms are names in the address, like `call.example.com/standup`.
- **Hosts hold a key.** Type it once and the browser remembers it. A host can open any room, remove people, lock the room and end the call.
- **Guests need only a name.** They get in only while a host is in the room, so a forgotten link is useless when nobody from your team is around.
- **Calls work well.** Camera, microphone, screen sharing with audio, device switching, active-speaker highlight, automatic quality adaptation, and an audio-only mode for weak connections.

All media goes through [LiveKit](https://livekit.io), a proven open-source media server. PlainCall is a small Go service that serves the web app and hands out LiveKit access tokens, plus a plain TypeScript front end.

## How it works

```
browser ──https──► Traefik ──► plaincall   web app and /api (Go)
   │                               │
   │                               │  access tokens, room management
   └──wss / udp / tcp──► LiveKit ◄─┘
```

**Rooms** exist only while someone is in them. Any name of 3 to 48 letters, digits and hyphens works. The start page can also make a random name such as `kfj-2hd-9xq` for calls that should not be guessable.

**Hosts** are people who present a member key. Keys are set by the operator, one per person, so a single person's access can be removed without affecting anyone else. Hosts can join a room at any time, see who is there, remove people, lock the room against new guests, and end the call for everyone.

**Guests** enter a name. If a host is in the room and it is not locked, they join. Otherwise they see a waiting screen and join automatically when a host arrives. If every host leaves, guests already in the call stay until they leave or a host ends it.

## Quick start for development

You need Go, Node, and the `livekit-server` binary ([install instructions](https://docs.livekit.io/home/self-hosting/local/)).

```sh
make dev
```

This starts LiveKit, the Go server and the Vite dev server, and prints a host key. Open http://localhost:5173.

## Running it for real

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for a Docker Compose setup behind Traefik.

To run the binary yourself:

```sh
make build
PLAINCALL_KEYS="alice:$(openssl rand -hex 16)" \
LIVEKIT_URL=wss://rtc.example.com \
LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... \
./bin/plaincall
```

Browsers only allow camera and microphone access on `https://` pages (and `localhost`), so put PlainCall behind a TLS-terminating proxy.

## Configuration

PlainCall reads environment variables.

| Variable | Required | Meaning |
| --- | --- | --- |
| `PLAINCALL_KEYS` | yes | Member keys as `label:secret`, separated by commas. Secrets need 16 or more characters and no spaces. The label appears in logs. |
| `LIVEKIT_URL` | yes | Public `ws://` or `wss://` address of the LiveKit server, as browsers reach it. |
| `LIVEKIT_API_KEY` | yes | LiveKit API key. |
| `LIVEKIT_API_SECRET` | yes | LiveKit API secret. |
| `LIVEKIT_API_URL` | no | Address this server uses to call LiveKit. Defaults to `LIVEKIT_URL` with `http(s)`. Set it to the internal address, such as `http://livekit:7880`, when both run in one Compose stack. |
| `PLAINCALL_ADDR` | no | Listen address. Default `:8080`. |
| `PLAINCALL_MAX_PARTICIPANTS` | no | People per room, 2 to 500. Default `20`. A full room tells the next person it is full. |
| `PLAINCALL_TRUST_PROXY_HEADERS` | no | `true` when behind a reverse proxy, so rate limits use the client address from `X-Forwarded-For`. Default `false`. |

## HTTP API

The web app is the only intended client.

| Endpoint | Body | Result |
| --- | --- | --- |
| `POST /api/join` | `{"room", "name", "key"?}` | `{"url", "token", "role"}`, or `409 waiting_for_host`, `403 room_locked`, `401 invalid_key` |
| `POST /api/rooms/{room}/kick` | `{"identity"}` | Removes a participant. Needs `Authorization: Bearer <key>`. |
| `POST /api/rooms/{room}/lock` | `{"locked": true}` | Locks or unlocks the room. Needs a key. |
| `POST /api/rooms/{room}/end` | none | Ends the call for everyone. Needs a key. |
| `GET /healthz` | | `ok` |

A participant's role travels inside the signed LiveKit token as the `role` attribute, so it cannot be changed by the browser.

## Things worth knowing

- **Room names are guessable.** Anyone who knows `/standup` can wait there, and will be admitted whenever a host is present. For sensitive calls use a random room and lock it once everyone has arrived.
- **Removing someone does not ban them.** They can rejoin unless the room is locked. Remove, then lock.
- **A lock lasts as long as the room does.** It is kept in the LiveKit room and is forgotten a couple of minutes after the last person leaves.
- **Keys are passwords.** Anyone with a key is a host everywhere. The browser stores it in local storage, so use the "Forget key" link on shared computers. To revoke someone, remove their entry from `PLAINCALL_KEYS` and restart.
- **Wrong keys are rate-limited**: 10 per ten minutes per address.
- **Calls are encrypted between each browser and the media server, not end to end.** The server operator can technically see media.
- **Screen-share audio** works in Chrome, Edge and other Chromium browsers when sharing a browser tab (and on Windows or ChromeOS, the whole system). Firefox and Safari share video only. Phones cannot share their screens from a browser.

## Repository layout

```
cmd/plaincall/     program entry point and container health check
internal/config/   environment settings and member keys
internal/rtc/      LiveKit access tokens and room management
internal/server/   HTTP handlers, security headers, static files
internal/ratelimit small fixed-window rate limiter
web/               the browser app (TypeScript, Vite) and its embedding
deploy/            Docker Compose files and LiveKit settings
e2e/               browser tests (Playwright)
docs/              deployment guide and test notes
```

The front end is plain TypeScript with no framework. Its only runtime dependencies are `livekit-client` and the `lucide` icon set.

## Development

```sh
make check   # formatting, vet, Go tests with race detector, web typecheck, tests and build
make test    # tests only
make e2e     # browser tests against a running server, see e2e/README.md
```

The Go tests use a fake LiveKit. To also test against a real one:

```sh
livekit-server --dev &
LIVEKIT_TEST_URL=http://127.0.0.1:7880 go test ./internal/rtc
```

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY.md](THIRD_PARTY.md).
