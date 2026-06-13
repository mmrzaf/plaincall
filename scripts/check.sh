#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

echo '==> Go format check'
UNFORMATTED=$(gofmt -l cmd internal)
if [ -n "$UNFORMATTED" ]; then
  printf '%s\n' "$UNFORMATTED"
  echo 'Run gofmt before committing.' >&2
  exit 1
fi

echo '==> Frontend dependencies'
(cd web && npm ci)

echo '==> Frontend type-check and production build'
(cd web && npm run build)

echo '==> Go tests'
go test ./...

echo '==> Go vet'
go vet ./...

echo '==> Go production build'
mkdir -p bin
go build -trimpath -o bin/plaincall ./cmd/plaincall

echo 'All checks passed.'
