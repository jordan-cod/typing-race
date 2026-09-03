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
 * What the text is made of.
 *
 * Both start on: the passages are written in real Portuguese, and that is the thing worth
 * practising. Turning them off makes an easier, faster text — useful for a keyboard that
 * fights accents, or for a race where everyone wants raw speed.
 */
export type StreamOptions = {
  accents: boolean;
  punctuation: boolean;
};

export const DEFAULT_STREAM_OPTIONS: StreamOptions = { accents: true, punctuation: true };

/** Everything that is not a letter, a digit or a space, plus the hyphen inside words. */
const PUNCTUATION = /[.,;:!?()"'—–]/g;

/**
 * Builds the text for one race.
 *
 * Passages are shuffled and joined into continuous prose rather than picked one at a time:
 * a player who reaches the end of a passage should just keep reading into the next sentence.
 * The whole room gets this one string, because racing against someone typing different words
 * is not a race — and for the same reason the options belong to the room, not to the player.
 */
export function buildStream(
  random: () => number = Math.random,
  options: StreamOptions = DEFAULT_STREAM_OPTIONS,
): string {
  const parts: string[] = [];
  let length = 0;

  while (length < STREAM_LENGTH) {
    for (const passage of shuffle(PASSAGES, random)) {
      const text = applyOptions(passage.text, options);
      parts.push(text);
      length += text.length + 1;
      if (length >= STREAM_LENGTH) break;
    }
  }

  return parts.join(" ");
}

/**
 * Strips what the options turned off.
 *
 * Without punctuation the text is also lowercased: a capital letter only exists because a
 * sentence started, and sentences are what the punctuation marked. Leaving the capitals would
 * keep the Shift presses while removing the marks that explain them.
 */
export function applyOptions(text: string, options: StreamOptions): string {
  let result = text;

  if (!options.accents) {
    // NFD splits a letter from its accent, so the accents can be dropped on their own. The
    // cedilla is not a combining mark in this form, hence the explicit pass.
    result = result
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .normalize("NFC");
  }

  if (!options.punctuation) {
    result = result
      .replace(PUNCTUATION, "")
      .replace(/\s{2,}/g, " ")
      .trim()
      .toLowerCase();
  }

  return result;
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
