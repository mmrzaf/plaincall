# PlainCall testing

## Automated checks

Run during development:

```sh
make check
```

Run before tagging a release:

```sh
make release-check
```

The automated suite verifies:

```text
Go formatting
warning-free frontend dependency installation
TypeScript type-check
Vite production build
Go unit and HTTP integration tests
Go vet
Go production build
```

Backend tests cover:

```text
short room-code generation and normalization
malformed room-code rejection
opaque internal LiveKit room derivation
Alpha 1 signed-link migration support
Alpha 1 signed-link tamper and expiry rejection
LiveKit JWT HMAC signature
LiveKit JWT room and participant claims
legacy invitation expiry cap on LiveKit JWT
publishing permission boundary
rate-limit reset behavior
allowed-origin enforcement
create-room -> issue-token HTTP flow
legacy bearer-path log redaction
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

The smoke test asserts that a short room code can mint a LiveKit JWT and that the JWT contains only an opaque `pc_...` room ID.

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
open fragment invite link in second browser
join by manually typing the room code
confirm both participants hear audio
mute and unmute
turn camera on and off
copy invite link
share and stop sharing screen
change microphone
change camera
leave and rejoin with the same short code
```

### Layout

```text
1, 2, 3, 4, 6, and 8 participants on desktop
1, 2, 3, 4, 6, and 8 participants on mobile portrait
rotate mobile to landscape during a call
join and leave repeatedly while watching for tile flicker
share screen while participant count changes
confirm camera tiles remain fully visible without cropping
confirm desktop screen sharing uses a camera side rail
confirm mobile portrait screen sharing uses a scrollable camera strip
share screens from two participants and confirm both shares remain reachable
```

### Camera semantics

```text
front-camera local self-view is mirrored
rear-camera local self-view is not mirrored
remote participant never receives mirrored video
flip camera before join
flip camera during call
select a physical rear camera after permissions are granted
```

### Media modes

```text
voice-first mode keeps speech clear on constrained bandwidth
balanced mode publishes 720p / 24fps
sharp-video mode prioritizes resolution
smooth-motion mode prioritizes frame rate
audio-only mode disables outgoing camera and incoming remote video
changing video mode does not interrupt microphone audio
maximum-stability voice mode republishes microphone audio at a 12kbps ceiling
balanced-speech voice mode republishes microphone audio at a 24kbps ceiling
clear-speech voice mode republishes microphone audio at a 48kbps ceiling
changing voice mode leaves video untouched
text/slides screen sharing remains readable
motion screen sharing remains smooth
```

### Reliability

```text
run a one-hour audio call
run an eight-participant call
switch from Wi-Fi to mobile hotspot during a call
briefly disable network and restore it
block UDP 7882 and confirm ICE/TCP fallback through 7881
optionally test TURN overlay from a restrictive corporate or VPN network
monitor host CPU and outbound bandwidth
```

## Release gate

Do not publish Alpha 2 until:

```text
make release-check passes
clean source extraction can start with make dev
make smoke passes
2-person browser call passes
8-person call passes
mobile portrait and landscape matrix passes
front/rear camera semantics pass
each media mode passes
1-hour call passes
network interruption test recovers
UDP-blocked TCP fallback test passes
```
