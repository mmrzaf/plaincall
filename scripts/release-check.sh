#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

./scripts/check.sh

echo '==> Shell syntax'
for script in scripts/*.sh; do
  sh -n "$script"
done

echo '==> Go race tests'
go test -race ./...

echo 'Release checks passed.'
