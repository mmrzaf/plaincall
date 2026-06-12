# PlainCall build report

Generated: 2026-06-12

## Included

```text
Go backend
embedded production frontend
signed stateless room links
LiveKit JWT generation
production Dockerfile
Traefik + LiveKit Compose deployment
local no-Docker development launcher
secret generator
HTTP smoke test
automated tests
CI workflow
operator documentation
```

## Verified in the build environment

```text
gofmt check                         passed
go test ./...                       passed
go vet ./...                        passed
go test -race ./...                 passed
npm ci                              passed
npm audit during install            0 vulnerabilities reported
TypeScript type-check               passed
Vite production build               passed
Go production build                 passed
shell syntax check                  passed
Compose YAML parse                  passed
compiled-binary GET /health         passed
compiled-binary POST /api/rooms     passed
compiled-binary POST /api/token     passed
embedded frontend delivery          passed
SPA room-route fallback             passed
secret generator                    passed
```

## Not executed in the build environment

A real browser-to-browser media call was not executed because the build environment does not provide Docker or a `livekit-server` binary. The repository includes `make dev` for this local test after installing LiveKit.

Run the browser release matrix in `docs/TESTING.md` before publishing a production tag.
