# The whole project from one place. `make` on its own prints what there is.

BINARY := bin/typing
GO_PACKAGES := ./...

.DEFAULT_GOAL := help

## help: list the targets
help:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/## /  /' | column -t -s ':'

## protocol: regenerate the TypeScript contract from internal/protocol
protocol:
	go tool tygo generate
	go test ./internal/race -run TestStatsGolden -update
	cd web && bun run format

## dev: the Go server on port 3001 plus Vite on 3000, which proxies to it
dev:
	@trap 'kill 0' EXIT INT TERM; \
	go run ./cmd/typing & \
	(cd web && bun run dev) & \
	wait

## web: build the site into web/dist, where the binary embeds it from
web:
	cd web && bun install --frozen-lockfile && bun run build

## build: the single binary, website included
build: web
	go build -trimpath -o $(BINARY) ./cmd/typing

## test: every suite, with the race detector on the Go side
test:
	go test -race $(GO_PACKAGES)
	cd web && bun run test

## check: formatting, vet, types and lint — what CI runs
check:
	@test -z "$$(gofmt -l cmd internal web)" || { echo "gofmt:"; gofmt -l cmd internal web; exit 1; }
	go vet $(GO_PACKAGES)
	cd web && bun run typecheck && bun run check
	@$(MAKE) --no-print-directory protocol-is-current

## protocol-is-current: fail if the generated contract is behind the Go source
protocol-is-current:
	@go tool tygo generate
	@git diff --quiet -- web/src/protocol/generated.ts \
		|| { echo "web/src/protocol/generated.ts is stale; run 'make protocol'"; exit 1; }

## docker: build the production image
docker:
	docker build -t typing:local .

## tidy: gofmt, go mod tidy and the frontend formatter
tidy:
	gofmt -w cmd internal web
	go mod tidy
	cd web && bun run format

## clean: drop build output
clean:
	rm -rf $(BINARY) web/dist/assets web/dist/index.html

.PHONY: help protocol dev web build test check protocol-is-current docker tidy clean
