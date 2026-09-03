/**
 * Race rules shared by server and client.
 *
 * The server is the only authority: it recomputes WPM, accuracy and ranking from the
 * progress reports it accepts. The client imports the same functions purely so the live
 * counters it shows match what the server will end up publishing.
 */

/** Standard typing convention: a "word" is 5 characters, whitespace included. */
export const CHARS_PER_WORD = 5;

/**
 * Ceiling used to reject impossible progress.
 *
 * The fastest verified human typists sit around 215 WPM (~18 chars/s) on short bursts.
 * We allow 25 chars/s so that a legitimately fast player is never punished, while a paste
 * or a scripted client jumping dozens of characters at once is still caught.
 */
export const MAX_CHARS_PER_SECOND = 25;

/**
 * Characters forgiven on top of the speed ceiling.
 *
 * Progress reports are batched (we do not send one message per keystroke) and the client
 * clock is only roughly aligned with the server's, so the very first report of a race can
 * legitimately look faster than a human. A fixed allowance absorbs that without opening a
 * hole big enough to paste a passage through.
 */
export const PROGRESS_GRACE_CHARS = 12;

export type ProgressRejection =
  | "not_racing"
  | "regressed"
  | "beyond_passage"
  | "errors_regressed"
  | "impossible_speed";

export type ProgressCheck = { ok: true } | { ok: false; reason: ProgressRejection };

export type ProgressCandidate = {
  previousChars: number;
  nextChars: number;
  previousErrors: number;
  nextErrors: number;
  passageLength: number;
  elapsedMs: number;
};

/**
 * Validates a progress report against the previous accepted one.
 *
 * The speed check is cumulative (from the race start, not from the previous report) on
 * purpose: checking each delta in isolation would let a cheater drip-feed a large jump
 * across several messages and still finish in an impossible total time.
 */
export function checkProgress(candidate: ProgressCandidate): ProgressCheck {
  const { previousChars, nextChars, previousErrors, nextErrors, passageLength, elapsedMs } =
    candidate;

  if (!Number.isInteger(nextChars) || !Number.isInteger(nextErrors)) {
    return { ok: false, reason: "regressed" };
  }
  if (nextChars < previousChars) return { ok: false, reason: "regressed" };
  if (nextChars > passageLength) return { ok: false, reason: "beyond_passage" };
  if (nextErrors < previousErrors) return { ok: false, reason: "errors_regressed" };
  if (elapsedMs < 0) return { ok: false, reason: "impossible_speed" };

  const maxChars = PROGRESS_GRACE_CHARS + (elapsedMs / 1000) * MAX_CHARS_PER_SECOND;
  if (nextChars > maxChars) return { ok: false, reason: "impossible_speed" };

  return { ok: true };
}

/** Net WPM over the characters the player actually got right. */
export function computeWpm(correctChars: number, elapsedMs: number): number {
  if (elapsedMs <= 0 || correctChars <= 0) return 0;
  const minutes = elapsedMs / 60_000;
  return round(correctChars / CHARS_PER_WORD / minutes, 1);
}

/**
 * Accuracy as a percentage of keystrokes that landed on the right character.
 *
 * A player who has not typed anything yet is shown 100 rather than 0 so the race screen
 * does not open on a discouraging number.
 */
export function computeAccuracy(correctChars: number, errors: number): number {
  const total = correctChars + errors;
  if (total <= 0) return 100;
  return round((correctChars / total) * 100, 1);
}

export type RankableEntry = {
  playerId: string;
  nickname: string;
  correctChars: number;
  errors: number;
  /** Milliseconds from the race start to the last character, or null if unfinished. */
  finishTimeMs: number | null;
  connected: boolean;
};

export type RankedEntry = RankableEntry & {
  rank: number;
  wpm: number;
  accuracy: number;
};

/**
 * Final ranking.
 *
 * Finishers come first, ordered by finish time. A dead heat down to the millisecond is
 * broken by accuracy (fewer errors wins) rather than by arrival order of the WebSocket
 * frames, which would make the result depend on network luck. If two players are still
 * identical after that they genuinely tie and share the same rank number, so a 1-1-3 podium
 * is possible. Players who never finished (including anyone who dropped) are ranked after
 * the finishers by how far they got, so a disconnect costs the race but not the placing.
 */
export function rankPlayers(entries: readonly RankableEntry[], elapsedMs: number): RankedEntry[] {
  const sorted = [...entries].sort(compareEntries);

  const ranked: RankedEntry[] = [];
  let currentRank = 0;
  sorted.forEach((entry, index) => {
    const previous = sorted[index - 1];
    const tied = previous !== undefined && isDeadHeat(previous, entry);
    currentRank = tied ? currentRank : index + 1;
    const duration = entry.finishTimeMs ?? elapsedMs;
    ranked.push({
      ...entry,
      rank: currentRank,
      wpm: computeWpm(entry.correctChars, duration),
      accuracy: computeAccuracy(entry.correctChars, entry.errors),
    });
  });

  return ranked;
}

function compareEntries(a: RankableEntry, b: RankableEntry): number {
  const aFinished = a.finishTimeMs !== null;
  const bFinished = b.finishTimeMs !== null;
  if (aFinished !== bFinished) return aFinished ? -1 : 1;
  if (aFinished && bFinished) {
    const byTime = (a.finishTimeMs as number) - (b.finishTimeMs as number);
    if (byTime !== 0) return byTime;
  } else {
    const byProgress = b.correctChars - a.correctChars;
    if (byProgress !== 0) return byProgress;
  }
  const byErrors = a.errors - b.errors;
  if (byErrors !== 0) return byErrors;
  return a.nickname.localeCompare(b.nickname, "pt-BR");
}

function isDeadHeat(a: RankableEntry, b: RankableEntry): boolean {
  return (
    a.finishTimeMs === b.finishTimeMs && a.correctChars === b.correctChars && a.errors === b.errors
  );
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
