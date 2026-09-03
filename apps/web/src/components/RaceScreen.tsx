import type { ClientMessage, RoomSnapshot } from "@typing-race/protocol";
import { computeAccuracy, computeWpm } from "@typing-race/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatNumber } from "../lib/format.ts";
import {
  applyKey,
  initialTypingState,
  isBlocked,
  isComplete,
  type TypingState,
} from "../lib/typing.ts";
import { PassageView } from "./PassageView.tsx";
import { PlayerLane } from "./PlayerLane.tsx";

type Props = {
  room: RoomSnapshot;
  selfId: string | null;
  send: (message: ClientMessage) => void;
  serverNow: () => number;
};

/** Progress is batched instead of sent per keystroke: 10 frames per second is plenty. */
const REPORT_INTERVAL_MS = 100;

export function RaceScreen({ room, selfId, send, serverNow }: Props) {
  const passage = room.passage ?? "";
  const [typing, setTyping] = useState<TypingState>(initialTypingState);
  const [focused, setFocused] = useState(true);
  const [elapsedMs, setElapsedMs] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastReportRef = useRef({ sentAt: 0, correctChars: -1, errors: -1 });

  const self = room.players.find((player) => player.id === selfId);
  const spectator = self?.spectator ?? false;
  const done = isComplete(typing, passage);

  useEffect(() => {
    setTyping(initialTypingState);
    lastReportRef.current = { sentAt: 0, correctChars: -1, errors: -1 };
  }, []);

  // The local timer is only for the counters on screen; the server keeps its own clock and
  // that is the one the result is built from.
  useEffect(() => {
    if (room.startAt === null) return;
    const startAt = room.startAt;
    const tick = () => setElapsedMs(Math.max(0, serverNow() - startAt));
    tick();
    const timer = setInterval(tick, 100);
    return () => clearInterval(timer);
  }, [room.startAt, serverNow]);

  const report = useCallback(
    (state: TypingState, mode: "throttled" | "flush" | "retry") => {
      const last = lastReportRef.current;
      const now = Date.now();
      const unchanged = state.correctChars === last.correctChars && state.errors === last.errors;
      if (unchanged && mode !== "retry") return;
      if (mode === "throttled" && now - last.sentAt < REPORT_INTERVAL_MS) return;
      lastReportRef.current = {
        sentAt: now,
        correctChars: state.correctChars,
        errors: state.errors,
      };
      send({ type: "progress", correctChars: state.correctChars, errors: state.errors });
    },
    [send],
  );

  // Flush whatever the throttle held back, so the last characters of the passage are never
  // stuck waiting for a timer that no keystroke will trigger again.
  useEffect(() => {
    if (spectator) return;
    const timer = setTimeout(() => report(typing, "flush"), REPORT_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [typing, report, spectator]);

  // The server drops a report it considers impossible, which also happens after a long stall
  // or a lost frame. Resending until the server catches up keeps an honest player from being
  // stuck behind a rejection they cannot see.
  const serverChars = self?.correctChars ?? 0;
  useEffect(() => {
    if (spectator || serverChars >= typing.correctChars) return;
    const timer = setTimeout(() => report(typing, "retry"), REPORT_INTERVAL_MS * 3);
    return () => clearTimeout(timer);
  }, [serverChars, typing, report, spectator]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // Shortcuts (including Ctrl/Cmd+V) are left to the browser and never treated as typing.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Tab") return;
    event.preventDefault();
    setTyping((current) => {
      const next = applyKey(current, event.key, passage);
      if (next !== current) report(next, "throttled");
      return next;
    });
  };

  const liveWpm = computeWpm(typing.correctChars, elapsedMs);
  const liveAccuracy = computeAccuracy(typing.correctChars, typing.errors);
  const others = room.players.filter((player) => !player.spectator);

  return (
    <div className="space-y-6">
      {spectator ? (
        <p className="rounded-lg border border-edge bg-surface px-4 py-3 text-sm text-muted">
          A corrida ja tinha comecado. Voce esta assistindo e entra na proxima.
        </p>
      ) : (
        <div className="flex gap-6 text-sm">
          <Stat label="PPM" value={formatNumber(liveWpm)} />
          <Stat label="Precisao" value={`${formatNumber(liveAccuracy)}%`} />
          <Stat label="Tempo" value={`${formatNumber(elapsedMs / 1000, 1)}s`} />
        </div>
      )}

      <button
        type="button"
        className="w-full cursor-text rounded-xl border border-edge bg-surface p-5 text-left"
        onClick={() => inputRef.current?.focus()}
      >
        <PassageView
          passage={passage}
          correctChars={typing.correctChars}
          hasError={isBlocked(typing)}
        />
      </button>

      {!spectator && (
        <div className="flex min-h-6 items-center gap-3 text-sm">
          <input
            ref={inputRef}
            // Hidden but focusable: it exists to open the mobile keyboard and to own focus.
            // Every keystroke is handled in onKeyDown, so the value is always empty and there
            // is nothing for a paste to land in.
            className="size-px opacity-0"
            value=""
            onChange={() => undefined}
            onKeyDown={handleKeyDown}
            onPaste={(event) => event.preventDefault()}
            onDrop={(event) => event.preventDefault()}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            // biome-ignore lint/a11y/noAutofocus: the race starts the instant this appears.
            autoFocus
          />
          {isBlocked(typing) && (
            <span className="text-danger">Tecla errada. Apague para continuar.</span>
          )}
          {done && <span className="text-accent">Voce terminou. Aguardando os outros.</span>}
          {!focused && !done && (
            <span className="text-muted">Clique no texto para voltar a digitar</span>
          )}
        </div>
      )}

      <div className="space-y-4 rounded-xl border border-edge bg-surface p-5">
        {others.map((player) => (
          <PlayerLane key={player.id} player={player} isSelf={player.id === selfId} />
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className="text-2xl tabular-nums">{value}</div>
    </div>
  );
}
