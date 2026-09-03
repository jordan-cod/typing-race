import { PASSAGES } from "./passages.ts";
import { MAX_CHARS_PER_SECOND, RACE_DURATION_MS } from "./rules.ts";

/**
 * How much text a race carries.
 *
 * The speed ceiling caps anyone at 25 characters per second, so a minute cannot consume more
 * than 1500 characters however fast the player is. Building twice that means the stream is
 * unreachable in practice, which is the point: the player should never see an end, because
 * seeing one turns the last seconds into a different game.
 */
export const STREAM_LENGTH = Math.ceil((RACE_DURATION_MS / 1000) * MAX_CHARS_PER_SECOND * 2);

/**
 * Builds the text for one race.
 *
 * Passages are shuffled and joined into continuous prose rather than picked one at a time:
 * a player who reaches the end of a passage should just keep reading into the next sentence.
 * The whole room gets this one string, because racing against someone typing different words
 * is not a race.
 */
export function buildStream(random: () => number = Math.random): string {
  const parts: string[] = [];
  let length = 0;

  while (length < STREAM_LENGTH) {
    for (const passage of shuffle(PASSAGES, random)) {
      parts.push(passage.text);
      length += passage.text.length + 1;
      if (length >= STREAM_LENGTH) break;
    }
  }

  return parts.join(" ");
}

/** Fisher-Yates, taking the source of randomness so a test can pin the order down. */
function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = copy[i];
    const b = copy[j];
    if (a === undefined || b === undefined) continue;
    copy[i] = b;
    copy[j] = a;
  }
  return copy;
}
