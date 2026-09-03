# Corrida de digitação

Multiplayer typing race. Two or more people enter a room, get the same passage, start at the
same server-decided instant and race to the end. The UI is in Brazilian Portuguese; the code,
identifiers and commit messages are in English.

## Stack

- Bun 1.3 workspaces monorepo
- `apps/api` — Elysia + WebSockets, `bun test`
- `apps/web` — React 19 + TanStack Router + Vite + Tailwind v4, Vitest
- `packages/protocol` — the wire contract (Zod 4) and the race rules, shared by both apps
- Biome for lint and format, TypeScript strict, no `any`

## Running it

```bash
bun install
bun run dev          # API on :3001 and web on :3000
```

Or one at a time:

```bash
bun run --filter @typing-race/api dev
bun run --filter @typing-race/web dev
```

The web app talks to `http://localhost:3001` by default. Override with `VITE_API_URL`; the API
reads `PORT` and `WEB_ORIGIN`.

## Trying a race with two browser windows

1. Open <http://localhost:3000>, type a nickname, click **Criar sala**.
2. Copy the room link (**Copiar link**) and open it in a second window.
3. The nickname is kept in `localStorage`, so a second window of the *same* browser arrives
   with the same name and the room refuses it. The screen asks for another nickname right
   there — type a different one and continue. Two different browsers (or one normal and one
   private window) skip this.
4. The second player clicks **Estou pronto**; the room owner clicks **Comecar corrida**.
5. Countdown, then type. Each window shows the other player's bar moving, plus its own WPM
   ("PPM") and accuracy.
6. First to finish wins. The result screen shows time, WPM and accuracy per player, and the
   room owner can start another race with a new passage.

Worth trying while you are there: try to paste into the passage (nothing happens), and close
one window mid-race (the other player keeps going and the dropout is ranked with the progress
they had).

## Tests

```bash
bun run test         # both apps
bun run typecheck
bun run check        # Biome
```

The rules that decide a race are pure functions, so they are tested directly rather than
through a socket: WPM and accuracy, progress validation (paste and impossible speed), ranking
including a millisecond photo finish and a true tie, mid-race disconnect, latecomers as
spectators, and the typing model on the web side.

## Decisions

**The server owns the result.** Clients report `correctChars` and `errors`; the server times
everything with its own clock, validates each report against the previous one, and computes
WPM, accuracy and the ranking itself. A rejected report leaves the stored progress untouched,
so a client claiming to have finished in 300ms simply does not move.

**Errors are strict, and the passage never changes.** A wrong character does not advance the
player, and it is never spliced into the text on screen. Instead the character they *should*
have typed is marked in the error colour, in place, and a Backspace clears the block.

This follows what the platforms people already know do. Monkeytype colours the expected
character red and never shows the glyph you actually hit; TypeRacer refuses to advance until
the word matches. Both keep the passage still, and for the same reason: it is the thing the
player is reading from. Splicing wrong letters into it reflows every following word at the
exact moment the player is trying to find their place again.

One Backspace clears a whole streak of wrong keys, not one press per mistake — there is
nothing on screen to erase, so counting presses against something invisible would be
guesswork. Wrong keys stop counting against accuracy after `MAX_WRONG_STREAK`, so leaning on
a key does not destroy the score. Correct characters can never be taken back, which keeps
progress monotonic and matching what the server accepts.

The alternative — letting errors through and only docking accuracy — is rejected because the
player's position and the passage would drift apart, leaving the server unable to tell an
honest mistake from a client quietly skipping characters.

**Paste is blocked twice.** The typing field discards `paste` and `drop` events and ignores
keystrokes with Ctrl/Cmd held, and the server independently rejects any progress faster than
25 characters per second (plus a 12-character allowance for batching and clock skew). The
speed check is cumulative from the start of the race, so a big jump cannot be smuggled through
in small pieces.

**Solo racing is opt-in.** With one person in the room, **Comecar corrida** is disabled and a
separate button reads *"Treinar sozinho, sem adversario"*. Racing alone is possible but never
accidental.

**Disconnects do not freeze anyone.** A racing player who drops keeps their lane and their
progress, and the race ends as soon as every *connected* racer has finished. Two more guards:
30 seconds after the first finish the race closes anyway, and there is a 5-minute hard cap.
A player who arrives after the start joins as a spectator and races in the next round.

**Rooms are ephemeral.** They live in memory, disappear when the last person disconnects, and
a code nobody ever used expires after two minutes. There is no database and no accounts — the
nickname is the whole identity.

**Ties.** Finishers are ordered by server-measured time; an exact millisecond tie is broken by
accuracy rather than by which WebSocket frame arrived first. If two players are identical on
both, they genuinely share a rank (1, 1, 3). Players who never finished are ranked after the
finishers by how far they got.

**No `StrictMode` on the client.** Its double-mount in development opens the race socket twice
and the second join is rejected as a duplicate nickname before the first one closes.

## Layout

```
apps/api/src/race/room.ts       race state machine — takes the clock as an argument, no I/O
apps/api/src/race/registry.ts   in-memory rooms and their lifetime
apps/api/src/index.ts           HTTP + WebSocket, translation only
packages/protocol/src/rules.ts  WPM, accuracy, progress validation, ranking
packages/protocol/src/messages.ts   client <-> server message shapes (Zod, validated both ways)
packages/protocol/src/passages.ts   20 built-in Portuguese passages
apps/web/src/lib/typing.ts      the typing model (strict errors), unit-tested
apps/web/src/lib/useRace.ts     socket, clock offset, reconnect-free state
```
