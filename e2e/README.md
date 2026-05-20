# Browser tests

Playwright tests that drive real browsers through PlainCall against a real LiveKit server. They live apart from `web/` so the app has no test-browser dependency.

## Run

1. Start LiveKit (`livekit-server --dev` uses the keys `devkey` / `secret`).
2. Build and start PlainCall with a member key, for example:

   ```sh
   make build
   export LIVEKIT_URL=ws://127.0.0.1:7880 LIVEKIT_API_URL=http://127.0.0.1:7880
   export LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret
   export PLAINCALL_KEYS="test:$(openssl rand -hex 16)"
   PLAINCALL_ADDR=127.0.0.1:8080 ./bin/plaincall
   ```

3. In another shell, with the same LiveKit variables set:

   ```sh
   export PLAINCALL_URL=http://127.0.0.1:8080
   export PLAINCALL_KEY=<the secret after "test:">
   cd e2e && npm ci && npx playwright install chromium firefox webkit
   make e2e            # from the repository root
   ```

Set `PLAINCALL_BIN` to run the failure test with another binary (default `bin/plaincall`).

## What runs

- **Chromium** runs every scenario, with fake camera, microphone and screen capture.
- **Firefox** runs the landing, lobby, waiting/admission, media, badges, moderation, lock and removal scenarios (fake media through preferences).
- **WebKit** runs only the landing and the lobby load, because it has no fake media devices.

Each test uses a random `e2e-xxxxxxxx` room. When the run ends, every LiveKit room whose name starts with `e2e-` is deleted through `RoomService/DeleteRoom`. This needs `LIVEKIT_API_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`; without them nothing is deleted.

The wrong-key tests count against the server's limit of ten wrong keys per address per ten minutes, so restart PlainCall between full runs if you repeat them quickly.

The test machine must reach LiveKit's media ports (7881/tcp, 7882/udp) and the node address it advertises. If signalling works but media never flows, check that first.
