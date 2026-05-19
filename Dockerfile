# syntax=docker/dockerfile:1
#
# Every source the build downloads from is a build argument, so the image can
# be built behind registry, module and package mirrors:
#
#   docker build \
#     --build-arg NODE_IMAGE=registry.example.com/library/node:22-alpine \
#     --build-arg GO_IMAGE=registry.example.com/library/golang:1.27-alpine \
#     --build-arg RUNTIME_IMAGE=registry.example.com/distroless/static-debian12:nonroot \
#     --build-arg GOPROXY=https://goproxy.example.com,direct \
#     --build-arg NPM_REGISTRY=https://npm.example.com/ \
#     --build-arg VERSION=v1.0.0 \
#     -t plaincall:1.0.0 .
ARG NODE_IMAGE=node:22-alpine
ARG GO_IMAGE=golang:1.27-alpine
ARG RUNTIME_IMAGE=gcr.io/distroless/static-debian12:nonroot

FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS web
ARG NPM_REGISTRY=https://registry.npmjs.org/
ENV npm_config_registry=${NPM_REGISTRY}
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM --platform=$BUILDPLATFORM ${GO_IMAGE} AS build
ARG GOPROXY=https://proxy.golang.org,direct
ENV GOPROXY=${GOPROXY} \
    GOTOOLCHAIN=local
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
COPY web/embed.go ./web/embed.go
COPY --from=web /src/web/dist ./web/dist
ARG TARGETOS
ARG TARGETARCH
ARG VERSION=dev
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o /out/plaincall ./cmd/plaincall

FROM ${RUNTIME_IMAGE}
COPY --from=build /out/plaincall /plaincall
EXPOSE 8080
ENTRYPOINT ["/plaincall"]
