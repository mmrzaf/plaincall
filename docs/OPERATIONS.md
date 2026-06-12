# PlainCall operations

## Production topology

```text
Internet
  |
  +-- call.example.com -- ArvanCloud proxy ON  -- Traefik -- web:8080
  |
  +-- rtc.example.com  -- ArvanCloud DNS-only  -- Traefik -- livekit:7880
  |
  +-- server-ip:7882/udp ------------------------------- livekit:7882
  |
  +-- server-ip:7881/tcp ------------------------------- livekit:7881
```

## Before deployment

1. Create DNS records:

   ```text
   call.example.com -> server public IP -> ArvanCloud proxy enabled
   rtc.example.com  -> server public IP -> ArvanCloud DNS-only
   ```

2. Open firewall ports:

   ```text
   443/tcp
   7881/tcp
   7882/udp
   ```

3. Confirm the external Docker network used by Traefik exists:

   ```sh
   docker network inspect proxy
   ```

4. Copy the environment template:

   ```sh
   cd deploy
   cp .env.example .env
   ../scripts/generate-secrets.sh
   ```

5. Paste the generated secrets into `.env` and set both domains.

## Deploy

```sh
cd deploy
docker compose --env-file .env -f compose.yml pull
docker compose --env-file .env -f compose.yml up -d
docker compose --env-file .env -f compose.yml ps
```

## Verify

```sh
curl -fsS https://call.example.com/health
```

Expected output:

```text
ok
```

Run the API smoke test:

```sh
PLAINCALL_BASE_URL=https://call.example.com \
PLAINCALL_ORIGIN=https://call.example.com \
../scripts/smoke.sh
```

Then run a browser call test from at least two separate devices and networks.

## Logs

```sh
cd deploy
docker compose --env-file .env -f compose.yml logs -f web
docker compose --env-file .env -f compose.yml logs -f livekit
```

PlainCall intentionally does not log:

```text
LiveKit API secrets
participant JWTs
full room links
microphone data
video data
screen-share data
```

## Upgrade

Pin versions in `.env`:

```dotenv
PLAINCALL_VERSION=0.1.0
LIVEKIT_VERSION=v1.13.1
```

Upgrade one component at a time:

```sh
docker compose --env-file .env -f compose.yml pull web
docker compose --env-file .env -f compose.yml up -d web

# After verifying web:
docker compose --env-file .env -f compose.yml pull livekit
docker compose --env-file .env -f compose.yml up -d livekit
```

Run the browser reliability test after a LiveKit upgrade.

## Troubleshooting

### Website works but calls do not connect

Check:

```text
rtc.example.com is DNS-only in ArvanCloud
rtc.example.com resolves to the server public IP
Traefik routes rtc.example.com to livekit:7880
7882/udp is open inbound
7881/tcp is open inbound
```

Inspect LiveKit logs:

```sh
docker compose --env-file .env -f compose.yml logs --tail=200 livekit
```

### Calls work on home networks but fail in strict offices

This is the signal to add TURN. Keep TURN out of v0.1 until this failure is reproduced.

### Calls connect but quality is poor

Check host CPU and network capacity. Media bandwidth is not carried by ArvanCloud or Traefik. It reaches LiveKit directly through `7882/udp` or `7881/tcp`.

Check whether clients are using TCP fallback excessively. UDP should be the normal path.

### HTTP API returns `room link is invalid or expired`

The room link either expired, was modified, or was not created by the currently deployed `PLAINCALL_SECRET_KEY`.

Changing `PLAINCALL_SECRET_KEY` invalidates existing room links. This is expected.

### Container starts but health check fails

Inspect:

```sh
docker compose --env-file .env -f compose.yml logs --tail=200 web
```

The Go app refuses to start when required production configuration is missing or secrets are too short.
