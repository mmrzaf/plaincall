# PlainCall testing

## Automated checks

Run:

```sh
make check
```

The automated suite verifies:

```text
Go formatting
Go unit and HTTP integration tests
Go vet
frontend dependency installation
TypeScript type-check
Vite production build
Go production build
```

Backend tests cover:

```text
signed room-link generation
signed room-link tamper rejection
signed room-link expiry rejection
LiveKit JWT HMAC signature
LiveKit JWT room and participant claims
publishing permission boundary
rate-limit reset behavior
allowed-origin enforcement
create-room -> issue-token HTTP flow
health endpoint
SPA fallback routing
```

## Local test without Docker

Install `livekit-server`, then run:

```sh
make dev
```

Open:

```text
http://localhost:8080
```

Run the API smoke test in a second terminal:

```sh
make smoke
```

## Browser release matrix

Test at minimum:

```text
Chrome desktop
Firefox desktop
Safari desktop when available
Chrome Android
Safari iOS when available
```

## Call release matrix

### Core flow

```text
create room
open invite link in second browser
join with display name
confirm both participants hear audio
mute and unmute
turn camera on and off
share and stop sharing screen
change microphone
change camera
leave and rejoin
```

### Reliability

```text
run a one-hour audio call
run an eight-participant call
switch from Wi-Fi to mobile hotspot during a call
briefly disable network and restore it
block UDP 7882 and confirm ICE/TCP fallback through 7881
monitor host CPU and outbound bandwidth
```

### Mobile

```text
join from a mobile browser
confirm camera remains off by default
turn camera on
rotate screen
background and foreground the browser
switch network if possible
```

## Release gate

Do not publish v0.1 until:

```text
make check passes
API smoke test passes
2-person browser call passes
8-person call passes
1-hour call passes
network interruption test recovers
UDP-blocked TCP fallback test passes
```
