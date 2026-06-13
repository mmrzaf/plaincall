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
  |
  +-- optional server-ip:443/udp ----------------------- embedded TURN/UDP
  |
  +-- optional server-ip:5349/tcp ---------------------- embedded TURN/TLS
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

5. Paste generated secrets into `.env` and set both domains.

## Deploy

```sh
cd deploy
docker compose --env-file .env -f compose.yml pull
docker compose --env-file .env -f compose.yml up -d
docker compose --env-file .env -f compose.yml ps
```

## Traefik middleware policy

The Compose template intentionally does not reference file-provider middleware names. The Go application already emits security headers and applies API rate limits. Add infrastructure-specific Traefik middleware locally only when those middleware definitions already exist in your Traefik installation. For example, a CDN source-IP allowlist is deployment-specific and must not be assumed by the generic template.

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

The smoke test creates a short room code, requests a participant token, and confirms that the LiveKit JWT carries only an opaque `pc_...` room ID.

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
short room codes
full invite links
microphone data
video data
screen-share data
```

New invite URLs use `/join#code`, so the code is not part of the HTTP page request. Alpha 1 `/r/<signed-link>` paths remain accepted during migration; the Go application redacts those paths in its own logs. Configure equivalent redaction at Traefik, CDN, and any external access-log layer until legacy links have aged out.

## Optional embedded TURN

Enable TURN only after reproducing failed joins from restrictive office Wi-Fi, VPNs, or mobile networks.

1. Add a TURN DNS record:

   ```text
   turn.example.com -> server public IP -> DNS-only
   ```

2. Put a trusted certificate and key in:

   ```text
   deploy/turn-certs/tls.crt
   deploy/turn-certs/tls.key
   ```

3. Set:

   ```dotenv
   LIVEKIT_TURN_ENABLED=true
   PLAINCALL_TURN_DOMAIN=turn.example.com
   LIVEKIT_TURN_UDP_PORT=443
   LIVEKIT_TURN_TLS_PORT=5349
   ```

4. Open:

   ```text
   443/udp
   5349/tcp
   ```

5. Start with the optional overlay:

   ```sh
   docker compose --env-file .env -f compose.yml -f compose.turn.yml up -d
   ```

The default optional overlay deliberately keeps TURN/TLS on `5349/tcp`, because Traefik already occupies `443/tcp` on a single-IP deployment. For the broadest restrictive-firewall coverage, place TURN/TLS on a separate public IP or behind an L4 load balancer and advertise `443/tcp`.

## Upgrade

Pin versions in `.env`:

```dotenv
PLAINCALL_VERSION=0.2.0-alpha.2
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

Enable and test the optional TURN overlay. Do not assume TURN is working merely because the container starts; validate from an actually restrictive network.

### Calls connect but quality is poor

First choose the appropriate in-call mode:

```text
Voice first    weak Wi-Fi, mobile data, stable speech
Balanced       normal calls
Sharp video    readable detail and visual inspection
Smooth motion  movement and demonstrations
Audio only     maximum stability and minimum bandwidth
```

For weak or unstable speech, also lower the independent voice mode:

```text
Maximum stability  12kbps mono speech for weak or unstable links
Balanced speech    24kbps mono speech for normal calls
Clear speech       48kbps mono voice when the network has room
```

Then check host CPU and outbound network capacity. Media traffic reaches LiveKit directly through `7882/udp`, `7881/tcp`, or the optional TURN ports.

### HTTP API returns `room code is invalid or expired`

For a new short code, check formatting. The code must contain ten supported characters, conventionally grouped as:

```text
abc-defg-hjk
```

For an Alpha 1 signed link, the embedded expiry may have elapsed or the signing secret may have changed.

### Container starts but health check fails

Inspect:

```sh
docker compose --env-file .env -f compose.yml logs --tail=200 web
```

The Go app refuses to start when required production configuration is missing or secrets are too short.
