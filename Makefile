.PHONY: dev run smoke test vet web-install web-check web-build build check clean secrets

dev:
	./scripts/dev.sh

run:
	PLAINCALL_DEV=true go run ./cmd/plaincall

smoke:
	./scripts/smoke.sh

test:
	go test ./...

vet:
	go vet ./...

web-install:
	cd web && npm ci

web-check:
	cd web && npm run check

web-build:
	cd web && npm ci && npm run build

build: web-build
	mkdir -p bin
	go build -trimpath -o bin/plaincall ./cmd/plaincall

check:
	./scripts/check.sh

secrets:
	./scripts/generate-secrets.sh

clean:
	rm -rf bin web/node_modules
