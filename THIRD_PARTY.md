# Third-party software

PlainCall is built on these projects.

| Component | Use | License |
| --- | --- | --- |
| [LiveKit server](https://github.com/livekit/livekit) | Media routing, run as its own container | Apache-2.0 |
| [LiveKit client SDK for JavaScript](https://github.com/livekit/client-sdk-js) | Calls in the browser, bundled into the web app | Apache-2.0 |
| [Lucide](https://github.com/lucide-icons/lucide) | Icons, bundled into the web app | ISC |
| [golang-jwt](https://github.com/golang-jwt/jwt) | Signing LiveKit access tokens | MIT |

Build tools (Vite, TypeScript, Vitest) are not part of the shipped app. Exact
versions of everything are recorded in `go.sum` and `web/package-lock.json`.
