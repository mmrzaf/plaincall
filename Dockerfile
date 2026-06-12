# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS web-build
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM golang:1.23-alpine AS go-build
WORKDIR /src
COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal
COPY --from=web-build /src/internal/webui/dist ./internal/webui/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/plaincall ./cmd/plaincall

FROM alpine:3.22
RUN apk add --no-cache ca-certificates wget \
    && addgroup -S plaincall \
    && adduser -S -G plaincall -H -s /sbin/nologin plaincall
COPY --from=go-build /out/plaincall /usr/local/bin/plaincall
USER plaincall
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/plaincall"]
