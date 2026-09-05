import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatNumber, position } from "../lib/format.ts";
import type { PersonalBest } from "../lib/personalBest.ts";
import type { Voice } from "../lib/sound.ts";
import { applyKey, initialTypingState, isBlocked, type TypingState } from "../lib/typing.ts";
import type { ClientMessage, RoomSnapshot } from "../protocol/index.ts";
import { computeAccuracy, computeWpm, RaceDurationMS } from "../protocol/index.ts";
import { Lanes } from "./Lanes.tsx";
import { StreamView, type WordFlash } from "./StreamView.tsx";

type Props = {
  room: RoomSnapshot;
  stream: string;
  selfId: string | null;
  send: (message: ClientMessage) => void;
  serverNow: () => number;
  keyboard: Voice;
  muted: boolean;
  onToggleMute: () => void;
  personalBest: PersonalBest | null;
  reduced: boolean;
  onTypingChange: (state: TypingState) => void;
};

/** Progress is batched instead of sent per keystroke: 10 frames per second is plenty. */
const REPORT_INTERVAL_MS = 100;
/** Below this the streak is noise; above it, it is worth telling the player about. */
const STREAK_FLOOR = 10;

export function RaceScreen({
  room,
  stream,
  selfId,
  send,
  serverNow,
  keyboard,
  muted,
  onToggleMute,
  personalBest,
  reduced,
  onTypingChange,
}: Props) {
  const [typing, setTyping] = useState<TypingState>(initialTypingState);
  /**
   * The authoritative copy while a keystroke is being handled.
   *
   * React may run a state updater more than once, so playing a sound or sending a frame from
   * inside one would double them. The ref also chains correctly when several keys land before
   * React re-renders, which at 8 characters a second it will.
   */
  const typingRef = useRef(typing);
  const [remainingMs, setRemainingMs] = useState(RaceDurationMS);
  const [flash, setFlash] = useState<WordFlash | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastReportRef = useRef({ sentAt: 0, correctChars: -1, errors: -1 });
  const lastKeyAtRef = useRef(0);

  const self = room.players.find((player) => player.id === selfId);
  const spectator = self?.spectator ?? false;

  useEffect(() => onTypingChange(typing), [typing, onTypingChange]);

  // The local clock is only for the number on screen; the server ends the race on its own.
  useEffect(() => {
    if (room.endsAt === null) return;
    const endsAt = room.endsAt;
    const tick = () => setRemainingMs(Math.max(0, endsAt - serverNow()));
    tick();
    const timer = setInterval(tick, 100);
    return () => clearInterval(timer);
  }, [room.endsAt, serverNow]);

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

  // Flush whatever the throttle held back, so the last characters of the minute are never
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

  const handleCharacter = useCallback(
    (key: string) => {
      keyboard.unlock();
      const current = typingRef.current;
      const next = applyKey(current, key, stream);
      if (next === current) return;

      typingRef.current = next;
      if (next.correctChars > current.correctChars) {
        keyboard.play("hit");
        if (stream[current.correctChars] === " ") {
          const end = current.correctChars + 1;
          const start = stream.lastIndexOf(" ", current.correctChars - 1) + 1;
          setFlash((previous) => ({ start, end, id: (previous?.id ?? 0) + 1 }));
        }
      }
      if (next.errors > current.errors) keyboard.play("miss");
      report(next, "throttled");
      setTyping(next);
    },
    [keyboard, report, stream],
  );

  /**
   * Typing goes straight into the race, with nothing to click first.
   *
   * The listener is on the window rather than on a focused field: if you are looking at the
   * race, your keystrokes belong to the race. The exceptions exist so the rest of the page
   * stays operable by keyboard — a focused button still answers Space and Enter, and a text
   * field anywhere still receives what is typed into it.
   */
  useEffect(() => {
    if (spectator || stream === "") return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") &&
        target !== inputRef.current
      ) {
        return;
      }
      if ((tag === "BUTTON" || tag === "A") && (event.key === " " || event.key === "Enter")) return;
      if (event.key === "Tab") return;

      if (event.key === "Backspace" || [...event.key].length === 1) {
        event.preventDefault();
        lastKeyAtRef.current = Date.now();
        handleCharacter(event.key);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleCharacter, spectator, stream]);

  /**
   * Fallback for on-screen keyboards, which often report `Unidentified` on keydown and only
   * say what was typed in `beforeinput`. Anything a real keydown already handled is skipped,
   * so a keyboard that fires both does not count the character twice.
   */
  const handleBeforeInput = (event: React.FormEvent<HTMLInputElement>) => {
    event.preventDefault();
    if (Date.now() - lastKeyAtRef.current < 60) return;
    const native = event.nativeEvent as InputEvent;
    if (native.inputType === "deleteContentBackward") return handleCharacter("Backspace");
    for (const char of native.data ?? "") handleCharacter(char);
  };

  const elapsedMs = RaceDurationMS - remainingMs;
  const liveWpm = computeWpm(typing.correctChars, elapsedMs);
  const liveAccuracy = computeAccuracy(typing.correctChars, typing.errors);
  const seconds = Math.ceil(remainingMs / 1000);
  const urgent = remainingMs <= 10_000;
  const aboveBest = personalBest !== null && liveWpm > personalBest.wpm;

  const racers = useMemo(
    () =>
      [...room.players.filter((player) => !player.spectator)].sort(
        (a, b) => (a.rank ?? 99) - (b.rank ?? 99),
      ),
    [room.players],
  );
  const myRank = self?.rank ?? null;
  const gap = describeGap(racers, selfId);

  return (
    <div className="space-y-7">
      <header className="flex items-start justify-between gap-6">
        <div>
          <div
            className={`tnum font-display text-[5rem] leading-[0.85] font-semibold tracking-tight tabular-nums ${
              urgent ? "text-signal" : "text-paper"
            }`}
            style={{ transition: reduced ? undefined : "color 400ms" }}
          >
            {seconds}
          </div>
          <div className="mt-1.5 text-sm text-dim">segundos</div>
        </div>

        {!spectator && (
          <div className="text-right">
            <div
              key={myRank ?? 0}
              className={`font-display text-3xl font-semibold ${
                myRank === 1 ? "text-best" : "text-paper"
              } ${reduced ? "" : "animate-streak-pop"}`}
            >
              {myRank === null ? "—" : position(myRank)}
            </div>
            {gap && <div className="mt-1.5 text-sm text-dim">{gap}</div>}
          </div>
        )}
      </header>

      <div className="border-t border-ink-700" />

      {spectator ? (
        <p className="text-sm text-dim">A corrida já tinha começado. Você entra na próxima.</p>
      ) : null}

      <StreamView
        stream={stream}
        correctChars={typing.correctChars}
        wrongChars={typing.wrongStreak}
        reduced={reduced}
        flash={flash}
      />

      {!spectator && (
        <>
          <input
            ref={inputRef}
            aria-label="Campo da corrida: digite o texto mostrado acima"
            className="size-px opacity-0"
            value=""
            onChange={() => undefined}
            onBeforeInput={handleBeforeInput}
            onPaste={(event) => event.preventDefault()}
            onDrop={(event) => event.preventDefault()}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            // The race is already running: asking the player to click first would cost them
            // the seconds this field exists to save.
            // biome-ignore lint/a11y/noAutofocus: focus belongs to the race the moment it starts
            autoFocus
          />
          <p aria-live="polite" className="sr-only">
            {isBlocked(typing) ? "Tecla errada. Apague para continuar." : ""}
          </p>
        </>
      )}

      <div className="border-t border-ink-700" />

      <Lanes players={room.players} selfId={selfId} />

      {!spectator && (
        <footer className="flex flex-wrap items-baseline gap-x-7 gap-y-2 text-sm">
          <span className={aboveBest ? "text-gain" : "text-paper"}>
            <span className="tnum text-lg">{formatNumber(liveWpm)}</span>
            <span className="ml-1.5 text-dim">ppm</span>
          </span>
          <span className="text-paper">
            <span className="tnum text-lg">{formatNumber(liveAccuracy)}%</span>
            <span className="ml-1.5 text-dim">precisão</span>
          </span>
          {typing.streak >= STREAK_FLOOR && (
            <span
              key={Math.floor(typing.streak / 10)}
              className={`text-signal ${reduced ? "" : "animate-streak-pop"}`}
            >
              <span className="tnum text-lg">{typing.streak}</span>
              <span className="ml-1.5 text-dim">seguidas</span>
            </span>
          )}
          {isBlocked(typing) && <span className="text-miss">apague para continuar</span>}

          <button
            type="button"
            onClick={onToggleMute}
            className="ml-auto text-dim hover:text-paper"
          >
            {muted ? "som desligado" : "som ligado"}
          </button>
        </footer>
      )}
    </div>
  );
}

/**
 * The distance to the player immediately ahead, in characters — the number that actually
 * changes hands during a race. The leader gets the gap to whoever is chasing them instead.
 */
function describeGap(
  racers: { id: string; nickname: string; correctChars: number; rank: number | null }[],
  selfId: string | null,
): string | null {
  const index = racers.findIndex((player) => player.id === selfId);
  if (index === -1 || racers.length < 2) return null;
  const me = racers[index];
  if (!me) return null;

  if (index === 0) {
    const chaser = racers[1];
    if (!chaser) return null;
    return `${me.correctChars - chaser.correctChars} à frente de ${chaser.nickname}`;
  }
  const ahead = racers[index - 1];
  if (!ahead) return null;
  return `${ahead.correctChars - me.correctChars} atrás de ${ahead.nickname}`;
}
