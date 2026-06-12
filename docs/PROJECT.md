# PlainCall project definition

## Statement

**PlainCall is a lightweight, self-hosted browser calling app.**

```text
A room. A link. A call.
```

Its job is to make small-team calls work with minimal setup and minimal operational complexity.

## Primary goal

> Join quickly, hear everyone clearly, survive ordinary network interruptions, and consume reasonable bandwidth and CPU.

Audio reliability has priority over video quality.

## Product rules

1. Calls first. Every feature must improve the call experience directly.
2. Audio is sacred. Video degrades before audio becomes unusable.
3. Guests join without accounts.
4. Rooms are ephemeral and stateless from PlainCall's perspective.
5. v0.1 targets 2–8 participants per room.
6. PlainCall configures LiveKit; it does not reimplement WebRTC or an SFU.
7. Operational simplicity beats premature scaling.

## v0.1 capabilities

```text
create room link
join by link and display name
pre-call device selection
microphone meter
optional camera preview
voice call
video call
screen sharing
mute
camera toggle
device switching
participant grid
active-speaker highlight
connection-quality label
reconnect state
copy invite link
mobile layout
```

## Explicit non-goals

```text
accounts
persistent rooms
database
chat
files
recording
transcription
AI summaries
calendar integration
OnlyTwo integration
Nestora integration
custom encryption protocol
custom WebRTC implementation
SIP
native apps
Redis
multi-node LiveKit
TURN in v0.1
```

## Component boundary

```text
plaincall-web
  custom Go application
  - embedded static frontend
  - signed room-link generation
  - LiveKit join-token issuance
  - health endpoint

plaincall-livekit
  official LiveKit server image
  - WebRTC signaling
  - SFU media routing
  - audio tracks
  - video tracks
  - screen-sharing tracks
  - reconnect support
```

The Go application never handles media packets.

## Why room links are signed

PlainCall does not maintain a room database. A room link contains:

```text
version.random-id.expiry.hmac-signature
```

The backend verifies the signature and expiry before issuing a LiveKit participant token. This preserves a stateless architecture while preventing arbitrary room-token minting.

Anyone with a valid room link may join. The room link is the invitation.

## Network topology

```text
call.example.com
  ArvanCloud enabled
  -> Traefik HTTPS
  -> web:8080

rtc.example.com
  ArvanCloud DNS-only
  -> Traefik HTTPS / WebSocket
  -> livekit:7880

server public IP
  -> 7882/udp primary media
  -> 7881/tcp fallback media
```

## Deployment boundary

```text
one repository
one Compose project
two services
two public subdomains
one existing HTTPS port
one direct UDP media port
one direct TCP fallback port
no Redis
no TURN initially
```

## API contract

### `GET /health`

Returns:

```text
200 OK
ok
```

### `POST /api/rooms`

Request:

```json
{}
```

Response:

```json
{
  "room": "r.<random>.<expiry>.<signature>",
  "url": "https://call.example.com/r/<room>",
  "expires_at": "2026-06-13T12:00:00Z"
}
```

### `POST /api/token`

Request:

```json
{
  "room_name": "r.<random>.<expiry>.<signature>",
  "participant_name": "Alice"
}
```

Response:

```json
{
  "server_url": "wss://rtc.example.com",
  "participant_token": "<signed-livekit-jwt>"
}
```

The LiveKit JWT allows publishing only:

```text
camera
microphone
screen_share
screen_share_audio
```

Data publishing is disabled because PlainCall does not provide chat or arbitrary realtime messages.

## Efficiency defaults

Frontend LiveKit options:

```ts
new Room({
  adaptiveStream: true,
  dynacast: true,
  videoCaptureDefaults: {
    resolution: VideoPresets.h720.resolution,
    frameRate: 24,
  },
});
```

Capture policy:

```text
microphone enabled on join
camera disabled on join unless enabled during preview
voice-oriented mono audio
camera maximum 720p / 24 fps
screen sharing maximum 1080p / 15 fps
```

## Deferred decisions

### TURN

Add TURN only if real tests show failed joins from restrictive networks where direct UDP and ICE/TCP both fail.

### Redis

Add Redis only when moving to multiple LiveKit nodes.

### Dedicated media host

Move LiveKit to a dedicated host only when media CPU or bandwidth affects other workloads.

## v0.1 definition of done

PlainCall v0.1 is ready when:

```text
eight participants can join the same link
voice works reliably
video works
screen sharing works
device switching works
a temporary network interruption is visible and recovers cleanly
clients can use UDP media
clients can fall back to ICE/TCP when UDP is blocked
no database, Redis, TURN, or external SaaS dependency is required
```
