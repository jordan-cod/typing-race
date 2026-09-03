/**
 * Race rules shared by server and client.
 *
 * The server is the only authority: it recomputes WPM, accuracy and the ranking from the
 * progress reports it accepts, on its own clock. The client imports the same functions purely
 * so the live counters it shows match what the server will end up publishing.
 */

/**
 * A race is a fixed minute for everyone.
 *
 * Nobody "finishes" — the text never ends — so the race is decided by how far each player got
 * before the clock ran out. A fixed duration also means every race is comparable, which is
 * what makes a personal best worth keeping.
 */
export const RACE_DURATION_MS = 60_000;

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
 * hole big enough to paste a paragraph through.
 */
export const PROGRESS_GRACE_CHARS = 12;

export type ProgressRejection =
  | "regressed"
  | "beyond_stream"
  | "errors_regressed"
  | "impossible_speed";

export type ProgressCheck = { ok: true } | { ok: false; reason: ProgressRejection };

export type ProgressCandidate = {
  previousChars: number;
  nextChars: number;
  previousErrors: number;
  nextErrors: number;
  streamLength: number;
  elapsedMs: number;
};

/**
 * Validates a progress report against the previous accepted one.
 *
 * The speed check is cumulative (from the race start, not from the previous report) on
 * purpose: checking each delta in isolation would let a cheater drip-feed a large jump across
 * several messages and still end the minute with an impossible total.
 */
export function checkProgress(candidate: ProgressCandidate): ProgressCheck {
  const { previousChars, nextChars, previousErrors, nextErrors, streamLength, elapsedMs } =
    candidate;

  if (!Number.isInteger(nextChars) || !Number.isInteger(nextErrors)) {
    return { ok: false, reason: "regressed" };
  }
  if (nextChars < previousChars) return { ok: false, reason: "regressed" };
  if (nextChars > streamLength) return { ok: false, reason: "beyond_stream" };
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
 * A player who has not typed anything yet is shown 100 rather than 0 so the race screen does
 * not open on a discouraging number.
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
  connected: boolean;
};

export type RankedEntry = RankableEntry & {
  rank: number;
  wpm: number;
  accuracy: number;
};

/**
 * The ranking, used both live during the minute and for the final result.
 *
 * Most correct characters wins, because that is the only thing the whole minute was spent on.
 * A dead heat on characters is broken by accuracy: between two players who typed exactly as
 * much, the one who hit fewer wrong keys did the better minute. Only when both numbers match
 * is it a real tie, and then the two share a rank, so a 1-1-3 podium is possible.
 *
 * Nothing here looks at who reported first: two players finishing the minute within
 * milliseconds of each other must not have the result decided by network luck. Disconnected
 * players stay in the ranking with the progress they had, so dropping out costs the race but
 * does not erase the minute.
 */
export function rankPlayers(entries: readonly RankableEntry[], elapsedMs: number): RankedEntry[] {
  const sorted = [...entries].sort(compareEntries);

  const ranked: RankedEntry[] = [];
  let currentRank = 0;
  sorted.forEach((entry, index) => {
    const previous = sorted[index - 1];
    const tied = previous !== undefined && isDeadHeat(previous, entry);
    currentRank = tied ? currentRank : index + 1;
    ranked.push({
      ...entry,
      rank: currentRank,
      wpm: computeWpm(entry.correctChars, elapsedMs),
      accuracy: computeAccuracy(entry.correctChars, entry.errors),
    });
  });

  return ranked;
}

function compareEntries(a: RankableEntry, b: RankableEntry): number {
  const byProgress = b.correctChars - a.correctChars;
  if (byProgress !== 0) return byProgress;
  const byErrors = a.errors - b.errors;
  if (byErrors !== 0) return byErrors;
  return a.nickname.localeCompare(b.nickname, "pt-BR");
}

function isDeadHeat(a: RankableEntry, b: RankableEntry): boolean {
  return a.correctChars === b.correctChars && a.errors === b.errors;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
