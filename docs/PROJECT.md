# PlainCall project definition

## Statement

**PlainCall is a lightweight, self-hosted browser calling app.**

```text
A room. A code. A call.
```

Its job is to make small-team calls work with minimal setup and minimal operational complexity.

## Primary goal

> Join quickly, hear everyone clearly, survive ordinary network interruptions, and consume reasonable bandwidth and CPU.

Audio reliability has priority over video quality unless the user explicitly chooses a video-focused mode.

## Product rules

1. Calls first. Every feature must improve the call experience directly.
2. Speech remains usable before video remains beautiful.
3. Guests join without accounts.
4. PlainCall stores no room database or room registry.
5. Alpha 2 targets 2–8 participants per room.
6. PlainCall configures LiveKit; it does not reimplement WebRTC or an SFU.
7. Operational simplicity beats premature scaling.

## Alpha 2 capabilities

```text
create short reusable room code
join by fragment link or typed code
join by display name
pre-call device selection and meter
optional camera preview
front/rear mobile camera flip
local front-camera mirror only
responsive participant geometry
stable keyed tile reconciliation
voice-first / balanced / sharp / smooth / audio-only modes
text-or-motion screen-sharing intent
mute and camera toggle
device switching
active-speaker highlight
connection-quality label
reconnect state
copy invite link
optional TURN overlay
```

## Explicit non-goals

```text
accounts
room database
persistent room metadata
chat
files
recording
transcription
AI summaries
calendar integration
custom encryption protocol
custom WebRTC implementation
SIP
native apps
Redis
multi-node LiveKit
```

## Component boundary

```text
plaincall-web
  custom Go application
  - embedded static frontend
  - short-code generation
  - opaque internal room-ID derivation
  - Alpha 1 signed-link migration support
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
  - optional embedded TURN
```

The Go application never handles media packets.

## Stateless short-code decision

New rooms use a short code:

```text
abc-defg-hjk
```

The browser shares:

```text
https://call.example.com/join#abc-defg-hjk
```

PlainCall stores no lookup table. The backend accepts a syntactically valid code and derives an opaque LiveKit room identifier with HMAC:

```text
pc_<opaque-derived-id>
```

This preserves the no-database architecture and keeps user-facing codes out of LiveKit room names. The deliberate trade-off is that short codes are reusable and manually guessable. They are convenience invitations, not high-security bearer capabilities.

Alpha 1 signed links remain accepted until their embedded expiry for migration. Their JWT expiry is capped by the signed-link expiry.

## API contract

### `GET /health`

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
  "room": "abc-defg-hjk",
  "code": "abc-defg-hjk",
  "url": "https://call.example.com/join#abc-defg-hjk"
}
```

### `POST /api/token`

Request:

```json
{
  "room_code": "abc-defg-hjk",
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

The JWT grants access to the opaque internal room ID, never the visible code. Alpha 1 clients may continue sending `room_name` during migration.

## Media policy

LiveKit room defaults:

```ts
new Room({
  adaptiveStream: true,
  dynacast: true,
});
```

Speech audio:

```text
mono capture
echo cancellation
noise suppression
automatic gain control
RED enabled
DTX enabled
```

Voice profiles:

| Mode | Publish ceiling | Use case |
|---|---:|---|
| Maximum stability | 12kbps | weak or unstable links |
| Balanced speech | 24kbps | normal calls |
| Clear speech | 48kbps | stronger links where voice detail matters |

Video profiles:

| Mode | Capture | Ceiling | Congestion preference |
|---|---:|---:|---|
| Voice first | 360p / 15fps | 350kbps | balanced |
| Balanced | 720p / 24fps | 1.2Mbps | balanced |
| Sharp video | 1080p / 20fps | 2.5Mbps | maintain resolution |
| Smooth motion | 720p / 30fps | 1.8Mbps | maintain frame rate |
| Audio only | disabled | 0 | remote video unsubscribed |

Screen sharing:

| Mode | Capture | Intent |
|---|---:|---|
| Text and slides | 1080p / 15fps | detail and readability |
| Smooth motion | 720p / 30fps | movement |

Layout policy:

```text
camera video uses contain rather than crop-heavy cover
desktop mixed calls use a screen-share stage plus camera side rail
narrow and portrait mixed calls use a screen-share stage plus horizontally scrollable camera strip
multiple simultaneous screen shares render as a stage gallery
```

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
  -> optional 443/udp TURN/UDP
  -> optional 5349/tcp TURN/TLS
```

## Deferred decisions

### Host moderation

Add host and guest capabilities only when real usage proves room locking, participant removal, or call termination are needed. Those controls add mutable room state.

### Redis

Add Redis only when moving to multiple LiveKit nodes.

### Dedicated media host

Move LiveKit to a dedicated host only when media CPU or bandwidth affects other workloads.
