# Third-party components

PlainCall depends on:

- [LiveKit client SDK](https://github.com/livekit/client-sdk-js), Apache-2.0, bundled into the embedded frontend during the Vite build.
- [LiveKit server](https://github.com/livekit/livekit), Apache-2.0, deployed as a separate pinned Docker image.

Frontend transitive dependencies are locked in `web/package-lock.json`.
