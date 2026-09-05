# One image, one process: the Go binary carries the website inside it.
#
# There used to be two — a Bun server and a Caddy serving the bundle — which meant two
# deploys that could disagree about which version was live. Now the HTML and the code that
# answers it are the same artefact and cannot drift apart.

# --- the website -----------------------------------------------------------------------
FROM oven/bun:1.3.13-alpine AS site
WORKDIR /src/web
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY web/ ./
RUN bun run build

# --- the binary ------------------------------------------------------------------------
FROM golang:1.25-alpine AS build
WORKDIR /src

# Dependencies first, so editing Go source does not re-download the module cache.
COPY go.mod go.sum ./
RUN go mod download

COPY cmd/ cmd/
COPY internal/ internal/
COPY web/embed.go web/
COPY --from=site /src/web/dist web/dist

# CGO off and no dynamic linker: this has to run on an image with no libc at all.
# The linker flags drop the symbol table and DWARF, which is a third of the binary and of no
# use in production — a panic still prints its stack trace.
ENV CGO_ENABLED=0 GOOS=linux
RUN go build -trimpath -ldflags="-s -w" -o /typing ./cmd/typing

# --- what ships ------------------------------------------------------------------------
FROM scratch
COPY --from=build /typing /typing

# A numeric UID needs no /etc/passwd, which is the only reason it can be set on an image that
# has no files but the binary.
USER 65534:65534
EXPOSE 3001

# The binary probes itself: see cmd/typing/main.go. Nothing else in this image could.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["/typing", "-healthcheck"]

ENTRYPOINT ["/typing"]
