# Design direction

## Subject

A 60-second race where the only thing you do is read and type. Two to eight people, a shared
link, one minute, one winner. The audience types for a living or close to it.

## The idea

A motorsport timing board. Not as decoration — as a vocabulary. A race with live positions,
gaps and a personal best already *is* a timing screen, and timing screens have a colour
convention that carries meaning:

| colour | means |
| --- | --- |
| violet | the best in the room right now |
| green | you just beat your own record |
| amber | live, running, urgent |
| red | a miss |

Colour is never spent on decoration, so when something turns violet it is worth looking at.

## Tokens

Ground is a deep petrol, not a tinted black: it has a real hue (205) and reads as a machine
chassis rather than "dark mode".

```
--ink-900  oklch(0.175 0.026 205)   ground
--ink-800  oklch(0.225 0.028 205)   raised
--ink-700  oklch(0.305 0.028 205)   hairlines
--paper    oklch(0.955 0.012 90)    the type you have already typed (warm against the ground)
--dim      oklch(0.545 0.022 205)   the type you have not reached yet
--signal   oklch(0.795 0.150 75)    amber: live, primary action
--best     oklch(0.680 0.190 300)   violet: fastest in the room
--gain     oklch(0.760 0.150 155)   green: personal best
--miss     oklch(0.625 0.200 25)    red: wrong key
```

## Type

- **Archivo** (variable) — display, the clock, positions, numbers. A grotesque built for
  timing tables and signage; tabular figures, tight tracking at large sizes.
- **IBM Plex Mono** — the stream itself and every number that sits next to it. Humanist enough
  to read for sixty seconds straight, monospaced so the caret and the line breaks can be
  computed exactly instead of measured.

Both are self-hosted through Fontsource: no CDN request, and the Docker build is deterministic.

## Layout

The stream is the interface. Everything else is marginalia pushed to the edges — no cards, no
nested boxes, no panel around the thing you are reading.

```
47                                     P2 de 3
segundos                               passou Bia
────────────────────────────────────────────────
   o cachorro aprendeu o barulho da chave na      <- dim, already read
   porta antes de aprender o proprio nome, e      <- live line, fixed position
   nunca errou uma vez sequer. Choveu a noite     <- dim, coming
────────────────────────────────────────────────
Ana     ███████████░░░░░░░░   312
você    ████████████████░░░░  366
Caio    ██████░░░░░░░░░░░░░░  180

74 ppm    98%    sequência 41
```

Everything is left-aligned: it is a reading interface, and a centred stream would be unusable.

## Principles

1. The stream is the hero. It gets the paper colour, the size and the stillness.
2. Colour means something or it is not used.
3. Zones are separated by space and a hairline, never by a box inside a box.
4. Motion only reports a change: the caret sliding, a position swap, the minute landing.
   Nothing loops, nothing floats, nothing fades in because a section scrolled into view.
