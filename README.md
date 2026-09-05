# Typing

Multiplayer typing race. Two or more people enter a room, get the same endless text, start at
the same server-decided instant and type for sixty seconds. Whoever gets the most correct
characters in the minute wins. The UI is in Brazilian Portuguese; the code, identifiers and
commit messages are in English.

Live at <https://typing.jrdan.dev>.

## Stack

- **Go 1.25** — the server and the race rules. Standard library HTTP, `coder/websocket`, one
  goroutine per socket. No framework.
- **React 19** + TanStack Router + Vite + Tailwind v4 for the site.
- The binary **embeds the built site**, so one artefact serves the page, the API and the
  WebSocket on one port. There is no second container and no way for the two to be on
  different versions.
- Biome for lint and format, TypeScript strict, no `any`.

### The wire contract is generated, not written twice

`internal/protocol` in Go is the only definition of what travels on the socket.
`web/src/protocol/generated.ts` comes out of it via [tygo](https://github.com/gzuidhof/tygo)
and must not be edited; `make protocol` regenerates it and CI fails if the committed file is
behind the Go source.

Two things resist generation, and both are pinned by tests rather than trusted:

- The **unions** (`RacePhase`, `ErrorCode`, `ClientMessage`, `ServerMessage`) are emitted by
  hand, because tygo flattens a Go string type to `string`. `TestGeneratedUnionsMatchGo` reads
  the generated file and fails if a Go constant is missing from it, or if it has a member Go
  does not.
- **WPM and accuracy** exist on both sides, because the browser recomputes them per keystroke
  instead of once per broadcast. The Go suite writes `stats.golden.json`; the Vitest suite
  checks the TypeScript against it. Change the formula on one side and the other goes red.

Fonts (Archivo, IBM Plex Mono) are self-hosted through Fontsource, so there is no CDN request
at runtime and the Docker build is deterministic. The visual direction is written down in
[`docs/design.md`](docs/design.md).

## Running it

```bash
make dev             # Go on :3001, Vite on :3000 proxying to it
```

Vite proxies `/api` and `/ws` to the Go server so development has one origin, the same as
production. Nothing about the deployment is baked into the bundle — the page talks to wherever
it was served from — so there is no `VITE_API_URL` to set. The server reads `PORT`.

`make` on its own lists every target.

```bash
make build           # the single binary, website included, into bin/
make protocol        # regenerate the TypeScript contract from the Go types
```

## Trying a race with two browser windows

1. Open <http://localhost:3000>, type a nickname, click **Chamar alguém**.
2. Copy the room link from the button at the top and open it in a second window.
3. The nickname is kept in `localStorage`, so a second window of the *same* browser arrives
   with the same name and the room refuses it. The screen asks for another nickname right
   there — type a different one and continue. Two different browsers (or one normal and one
   private window) skip this.
4. The second player clicks **Estou pronto**; the room owner clicks **Começar corrida**.
5. Countdown, then just type — there is nothing to click into first.
6. After sixty seconds the race ends on its own. The winner gets confetti; everyone gets the
   board with characters, WPM and accuracy, and the room owner can start another minute on
   new text.

Worth trying while you are there: paste into the page (nothing happens), mute the sound and
reload (it stays muted), close one window mid-race (the other player keeps going and the
dropout keeps the characters they had), and narrow the window to phone width (the text
re-wraps and the race keeps running).

## Tests

```bash
make test            # go test -race, then Vitest
make check           # gofmt, go vet, tsc, Biome, and that the contract is current
```

The rules that decide a race take the clock as an argument and do no I/O, so they are tested
directly rather than through a socket: the sixty-second end on the server clock, ranking by
correct characters with accuracy breaking a dead heat and a genuine tie sharing a rank,
progress validation (paste and impossible speed), late reports still in flight when the bell
rings, mid-race disconnects, latecomers as spectators, and on the web side the typing model,
the streak, and the line layout that scrolls the text.

On top of that the server is tested over a real WebSocket — joining, the ready gate, both
players receiving the same text, the countdown instants, a malformed frame being answered
without killing the socket, and a fatal error reaching the browser before the socket closes.

`go test` runs with `-race` everywhere, including in CI. The server is goroutine-per-socket,
so a suite without it would be testing a program nobody runs.

## Decisions

**A race is a minute, and the text never ends.** Nobody finishes anything. The stream is every
passage shuffled and joined into ~3000 characters of continuous prose — twice what the speed
ceiling allows anyone to type in sixty seconds, so no player can reach the end and start
playing a different game from the others in the last seconds. The room builds it once and
hands the same string to everybody; racing against someone typing different words is not a
race. It travels on its own WebSocket message rather than inside the state snapshot, which is
broadcast eight times a second.

**The server owns the minute and the result.** Clients report `correctChars` and `errors`;
the server times everything with its own clock, validates each report against the previous
one, and computes WPM, accuracy and the ranking itself. It ends the race at the scheduled
instant rather than whenever its tick happens to fire, so a late tick cannot shorten anyone's
race. Reports still in flight when the bell rings are counted for one more second, but always
measured against a sixty-second budget: the window buys latency, not typing time.

**Errors are strict: you must fix them.** A wrong character never advances the player, and the
text on screen is never rewritten with what they actually typed — the expected character turns
red in place, with a short shake, and one Backspace clears the block. That is what Monkeytype
and TypeRacer both do, and the reason is practical: the text is what the player is reading
from, so splicing their mistakes into it moves every following word at the exact moment they
are trying to find their place. Every wrong keystroke also counts against accuracy, so a
mistake costs both time and percentage. After eight wrong keys at one position further presses
stop counting, so leaning on a key is not a death sentence.

**Paste is blocked twice.** The field discards `paste` and `drop` and ignores keystrokes with
Ctrl/Cmd held, and the server independently rejects any progress faster than 25 characters per
second (plus a 12-character allowance for batching and clock skew). The check is cumulative
from the start of the race, so a large jump cannot be smuggled through in small pieces.

**Typing starts with the race.** The keydown listener is on the window, not on a focused
field: if you are looking at the race, your keystrokes belong to the race. A hidden input
still holds focus so mobile keyboards open and screen readers have something to land on, and
`beforeinput` is handled as a fallback for on-screen keyboards that report `Unidentified`. A
focused button still answers Space and Enter.

**Sound is on by default and off in one click.** Web Audio with two oscillators rather than an
`<audio>` element per keystroke, which at eight presses a second would allocate a decoder and
miss the moment. A wrong key gets a duller, lower thud. The choice is remembered in
`localStorage`, and a failure in the audio stack closes it rather than throwing its way up
into React and costing someone the race.

**What the player is told while racing**: the clock, their live position among the players,
the gap in characters to the player immediately ahead (or to the chaser, if they are leading),
the current streak of correct characters, live WPM that turns green when it is above their
personal best, and accuracy. Each of those answers "what is happening to me right now"; the
progress bars are scaled against the leader rather than against the text, because with an
endless stream "how far along am I" is not a question the race can answer.

**Personal best lives in `localStorage`.** There are no accounts, and every race being the same
fixed minute is what makes two results comparable at all.

**Solo racing is opt-in.** With one person in the room, **Começar corrida** is disabled and a
separate link offers training alone, described as training rather than a race.

**Disconnects do not freeze anyone.** A racing player who drops keeps their lane and their
characters and stays in the ranking; the race only ends early if *everyone* has dropped.
Someone who arrives after the start watches this minute and races in the next one.

**One binary, one container.** The Go binary embeds the built site and serves it, the API and
the WebSocket from the same port. The production image is `FROM scratch` — the binary and
nothing else, 12 MB, running as an unprivileged UID with every capability dropped. It has no
shell, so the container healthcheck is the binary asking itself: `typing -healthcheck`.

**One mutex, not an actor per room.** The room state machine does no locking of its own; the
hub holds a single lock and only while state is being read or written. Frames leave through a
buffered channel per connection, so a slow client can never stall a room from inside the
critical section — and if it falls more than four seconds behind, its socket is closed and it
reconnects rather than holding everyone else up.

**Rooms are ephemeral.** In memory, gone when the last person disconnects, and a code nobody
ever used expires after two minutes. No database.

**Reduced motion is respected** in JS as well as CSS: no confetti, no shake, no smooth scroll,
and the result numbers appear instead of counting up.

**No `StrictMode` on the client.** Its double-mount in development opens the race socket twice
and the second join is rejected as a duplicate nickname before the first one closes.

## Layout

```
cmd/typing/main.go               the process: flags, signals, graceful shutdown
internal/protocol/messages.go    the wire contract — tygo generates the TypeScript from this
internal/protocol/parse.go       the only place a client is taken at its word
internal/race/room.go            race state machine — takes the clock as an argument, no I/O
internal/race/registry.go        in-memory rooms and their lifetime
internal/race/rules.go           WPM, accuracy, progress validation, ranking
internal/race/stream.go          builds the endless text for one race
internal/race/passages.go        20 built-in Portuguese passages
internal/server/hub.go           sockets, broadcast, and the one ticker that drives every room
internal/server/handlers.go      one client frame in, the frames it produced out
internal/server/server.go        routes, and the embedded site with its SPA fallback
web/embed.go                     carries web/dist into the binary
web/src/protocol/generated.ts    generated — do not edit
web/src/lib/typing.ts            the typing model (strict errors, streaks), unit-tested
web/src/lib/lines.ts             line layout: index -> line and column, unit-tested
web/src/lib/sound.ts             Web Audio keystrokes
web/src/components/StreamView.tsx    three lines, live line held still
```

Deploy is described in [`docs/deploy.md`](docs/deploy.md).
