/**
 * Live WPM and accuracy, recomputed in the browser.
 *
 * The server publishes both numbers on every snapshot and its word is final — this is only so
 * the counters move with the keystrokes instead of stepping once per broadcast.
 *
 * That makes it the one piece of the contract that exists twice, so it is pinned:
 * `stats.golden.json` is written by the Go suite and `stats.test.ts` checks these functions
 * against it. Change the formula on either side and one of the two suites goes red.
 */

/** Standard typing convention: a "word" is 5 characters, whitespace included. */
export const CHARS_PER_WORD = 5;

export function computeWpm(correctChars: number, elapsedMs: number): number {
  if (elapsedMs <= 0 || correctChars <= 0) return 0;
  const minutes = elapsedMs / 60_000;
  return round1(correctChars / CHARS_PER_WORD / minutes);
}

/**
 * A player who has not typed anything yet is shown 100 rather than 0, so the race screen does
 * not open on a discouraging number.
 */
export function computeAccuracy(correctChars: number, errors: number): number {
  const total = correctChars + errors;
  if (total <= 0) return 100;
  return round1((correctChars / total) * 100);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
