# Testing

## Automated

| What | Command |
| --- | --- |
| Formatting, vet, Go tests (race), web typecheck, web tests, web build | `make check` |
| Go against a real LiveKit | `LIVEKIT_TEST_URL=http://127.0.0.1:7880 go test -count=1 ./internal/rtc` |
| Real browsers | `make e2e` (see `e2e/README.md`) |

`LIVEKIT_TEST_KEY` and `LIVEKIT_TEST_SECRET` default to LiveKit's `--dev` credentials. CI runs all of this on every push to `develop` and `main`, and again on a release tag before anything is published.

The browser tests cover joining, waiting and admission, moderation, locking, screen sharing, audio-only mode, reconnecting, a six-person layout, the phone layout, host key handling and the failure messages. They use fake cameras and microphones, so they check that media flows, not how it looks or sounds.

## Manual checks before a release

Try these on the deployed site. The first two sections are the ones automation cannot reach.

**Browsers.** Do the core flow in each: Chrome and Firefox on desktop, Safari on a Mac, Chrome on Android, Safari on an iPhone.

- Join from two devices, and hear and see each other.
- Mute and unmute, camera off and on, copy the link.
- Change the microphone, camera and speaker in Settings.
- Share a screen and stop sharing.
- Leave and rejoin the same room.

**Phones**
- Rotate the phone during a call. Tiles stay whole and nothing scrolls the page.
- Lock the screen and return. The call comes back.
- Screen sharing is not offered on phone browsers. The Share button is hidden.

**Layout.** With real cameras, try 1, 2, 3, 4, 6 and 8 people on a desktop and on a phone in portrait.
- Join and leave repeatedly. Tiles do not flicker.
- Start a screen share while people join. Cameras move to the side rail, or to a strip below the share on a phone.
- Two people sharing at once: both shares stay reachable.
- Your own camera is mirrored only if "Mirror my camera" is on, and other people never see it mirrored.

**Screen share audio**
- Share a browser tab with "share tab audio" on. The other person hears it.
- Stopping from the browser's own "Stop sharing" bar clears the share for everyone.

**Reliability**
- Run a one-hour audio call.
- Run an eight-person call and watch the server's CPU and outbound bandwidth.
- Switch a phone from Wi-Fi to mobile data during a call. It reconnects.
- Block `7882/udp` on the client's network. The call continues over `7881/tcp`.

**TURN** (only if the `turn` section of `livekit.yaml` is enabled)
- From a network that blocks UDP, join a call with a second person. Video and audio flow.
- In `chrome://webrtc-internals`, the selected candidate pair includes a `relay` candidate.

**Deployment**
- `curl -I https://<rtc domain>` answers from LiveKit, not a CDN.
- `7881/tcp` and `7882/udp` are reachable from outside.
- `docker compose ps` shows PlainCall healthy.

## Release gate

Do not tag a final release until all of these hold:

- `make check` and `make e2e` pass, and CI is green on the commit.
- A clean checkout builds with `make build`.
- A two-person call passes between two real devices on different networks.
- The eight-person call, the network interruption and the UDP-blocked checks pass.
- The image starts and reports healthy with the Compose files in `deploy/`.
