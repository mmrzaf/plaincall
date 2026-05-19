.PHONY: web build run dev test check e2e fmt clean

# Build the browser app, which the Go binary embeds.
web:
	cd web && npm ci && npm run build

build: web
	go build -trimpath -o bin/plaincall ./cmd/plaincall

# Run the server with the settings in your environment (see README.md).
run: build
	./bin/plaincall

# Run LiveKit, the server and the Vite dev server together.
dev:
	./scripts/dev.sh

test:
	go test ./...
	cd web && npm test

# Everything CI runs.
check:
	@test -z "$$(gofmt -l .)" || { echo "gofmt needed:"; gofmt -l .; exit 1; }
	go vet ./...
	go test -race ./...
	cd web && npm ci && npm run check && npm test && npm run build

# Browser tests against a running server. See e2e/README.md.
e2e:
	cd e2e && npm ci && npx playwright test

fmt:
	gofmt -w .

clean:
	rm -rf bin web/node_modules e2e/node_modules
	find web/dist -mindepth 1 ! -name .gitkeep -delete
