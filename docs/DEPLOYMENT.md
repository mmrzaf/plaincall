# Deploying PlainCall

This guide sets up PlainCall and LiveKit with Docker Compose behind an existing Traefik.

## How the pieces connect

```
Internet
  |
  +-- call.example.com  -- Traefik (443/tcp, TLS) -- plaincall:8080
  |
  +-- rtc.example.com   -- Traefik (443/tcp, TLS) -- livekit:7880   signalling
  |
  +-- server address :7882/udp ---------------------- livekit:7882   media
  |
  +-- server address :7881/tcp ---------------------- livekit:7881   media fallback
  |
  +-- optional :443/udp and :5349/tcp --------------- livekit        TURN relay
```

Media never passes through Traefik. It goes straight to the server's own ports.

## What you need

- A Linux server with Docker and the Compose plugin.
- Traefik already running, with a `websecure` entry point, working certificates, and an external Docker network named `proxy`.
- Two DNS names pointing at the server, for example `call.example.com` and `rtc.example.com`.
- These ports open in the server's firewall:
  - `443/tcp` for Traefik, if not already open.
  - `7881/tcp` and `7882/udp` for LiveKit media.

Confirm the Traefik network exists before you start: `docker network inspect proxy`.

The RTC name carries WebSocket signalling for media, so it must reach the server directly. If your DNS provider offers a CDN or proxy, turn it off for the RTC name (DNS-only). The main name can be proxied.

## Set up

```sh
cd deploy
cp .env.example .env
../scripts/generate-secrets.sh alice   # prints a LiveKit key, secret and a member key
```

Edit `.env`: paste the generated values, set `PLAINCALL_DOMAIN` and `PLAINCALL_RTC_DOMAIN`, then start everything.

```sh
docker compose up -d
docker compose ps
curl https://call.example.com/healthz   # ok
```

Open `https://call.example.com`, choose a room name, open the "I have a host key" section and enter your key. Anyone else opening the same room link and entering a name is admitted while you are in the room.

## Members and keys

`PLAINCALL_KEYS` holds one entry per person, as `label:secret` separated by commas:

```
PLAINCALL_KEYS=alice:3f9c1e...,bob:a81d77...
```

To add someone, generate a secret with `openssl rand -hex 16` and add an entry. To revoke someone, delete their entry. Apply changes with:

```sh
docker compose up -d
```

Logs record which label joined a room or performed an action, never the secret.

## Logs

```sh
docker compose logs -f plaincall
docker compose logs -f livekit
```

PlainCall writes one JSON line per request and per moderation action. They contain room names, client addresses and the label of the key that was used. They never contain keys, access tokens, display names or media. Room names are part of every page address, so proxy and CDN access logs contain them too.

## Sizing

Capacity is set by the server's network bandwidth and CPU, not by PlainCall. Each participant sends one video stream and receives everyone else's, so traffic grows quickly with room size. LiveKit lowers quality automatically when links are constrained.

`max_participants` in `livekit.yaml` caps a room (20 by default). Raise it only if the server has the bandwidth for it.

## Optional: TURN for restrictive networks

Some corporate or mobile networks block the UDP and TCP ports media uses. LiveKit's built-in TURN relay lets those people connect over `443` and `5349`.

1. Add a DNS name such as `turn.example.com` pointing at the server.
2. Put a certificate for it in `deploy/turn-certs/` as `tls.crt` and `tls.key`.
3. In `livekit.yaml`, uncomment the `turn` section and set `domain`.
4. Start with the extra ports and certificate mount:

```sh
docker compose -f compose.yml -f compose.turn.yml up -d
```

Port `443/udp` must be free on the host. TURN over TLS uses `5349/tcp` because Traefik already holds `443/tcp` on a single-address server. To cover the strictest firewalls, give TURN its own public address or put it behind a layer-4 load balancer and advertise `443/tcp`.

## Upgrading

```sh
docker compose pull
docker compose up -d
```

Set `PLAINCALL_IMAGE` (for example `ghcr.io/mmrzaf/plaincall:1.0.0`) and `LIVEKIT_VERSION` in `.env` to control when versions change. Active calls are dropped while containers restart.

Upgrade one component at a time, and check a two-person call after each:

```sh
docker compose pull plaincall && docker compose up -d plaincall
docker compose pull livekit && docker compose up -d livekit
```

Run the checks in [TESTING.md](TESTING.md) after a LiveKit upgrade.

## Releases

Pushing a tag such as `v1.0.0` runs every check, then publishes:

- The multi-architecture image `ghcr.io/mmrzaf/plaincall`, tagged with the version, and for final releases also `major.minor` and `latest`.
- A GitHub release with `plaincall_linux_amd64` and `plaincall_linux_arm64` (the web app is inside), the linux/amd64 image as a `.tar.gz` for hosts without registry access (`gunzip -c file | docker load`), and `SHA256SUMS`.

Tags with a suffix, such as `v1.0.0-beta.1`, are marked as pre-releases and do not move `latest`. To publish an existing tag again, run the release workflow by hand and give it the tag.

## Deploying with Gitman

`.gitman.yml` builds the image on the Gitman host for every run on `develop` and `main`, and deploys `v*` tags to `/srv/apps/plaincall`. That directory needs a `.env` made from `deploy/.env.example`. Each deploy rewrites `docker-compose.yml` and `livekit.yaml` there, sets `PLAINCALL_IMAGE` to the image it built, and runs `docker compose up -d`. To use TURN, add `compose.turn.yml` yourself and run Compose with both files by hand.

## Without Traefik

Any reverse proxy that terminates TLS and forwards WebSockets works. Proxy the main name to `plaincall:8080` and the RTC name to `livekit:7880`. Keep `PLAINCALL_TRUST_PROXY_HEADERS=true` only if the proxy sets `X-Forwarded-For` itself.

## Troubleshooting

**Nothing loads.** Check `docker compose ps` and `docker compose logs plaincall`. A configuration mistake makes PlainCall exit with a message naming the variable.

**"The call server is not responding".** PlainCall cannot reach LiveKit. Check `docker compose logs livekit` and that `LIVEKIT_API_URL` is `http://livekit:7880`.

**The container starts but stays unhealthy.** The health check calls `/plaincall healthcheck`, which asks `/healthz` on `PLAINCALL_ADDR`. Read `docker compose logs plaincall`. PlainCall exits at start if a setting is missing or a key is too short.

**Guests see "Waiting for the host" forever.** A host must be in the room. Hosts join by entering a key on the join screen.

**The call connects but nobody's video or sound arrives.** Media ports are blocked. Confirm `7881/tcp` and `7882/udp` are open in the server firewall and any cloud security group. When UDP is blocked but `7881/tcp` is open, media falls back to TCP with lower quality. If some networks still fail, enable TURN. Also check that the RTC name is DNS-only and resolves to the server's public address.

**The browser cannot use the camera or microphone.** Pages must be served over `https://`. Also check the browser's site permissions.

**Everyone shares one rate limit.** Behind a proxy or CDN, set `PLAINCALL_TRUST_PROXY_HEADERS=true` so the client address is read from `X-Forwarded-For`. Make sure the proxy passes the real client address through.
