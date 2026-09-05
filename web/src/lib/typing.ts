/**
 * Typing model for the race input.
 *
 * Error policy: strict. A wrong character never advances the player, and the stream on screen
 * is never rewritten with what they actually typed. This is what the platforms people already
 * know do: Monkeytype colours the *expected* character in the error colour and never shows the
 * mistyped glyph, and TypeRacer refuses to advance until the word matches. Injecting the wrong
 * characters into the text turns the thing the player is reading into a moving target —
 * exactly when they need it to stand still.
 *
 * Letting errors through and only docking accuracy is the other common option. It is rejected
 * here because progress and the text would drift apart, and the server would have no way to
 * tell an honest mistake from a client silently skipping characters.
 *
 * A wrong key still moves the cursor forward, over the character that should have been typed,
 * and that character is marked. So two wrong keys leave two marked characters behind the
 * cursor, and the player can see that two Backspaces are owed — the amount of red on screen is
 * the number of presses it costs. Backspace walks back one at a time for the same reason:
 * clearing everything with one press would make the count on screen a lie.
 *
 * Correct characters are never given back, only the marked ones, which keeps client progress
 * monotonic and matching what the server accepts.
 */

/**
 * How far wrong keys can push the cursor before further ones are ignored. It caps the damage
 * from leaning on a key, and it stops the marked run from swallowing the line the player still
 * has to read.
 */
export const MAX_WRONG_STREAK = 8;

export type TypingState = {
  correctChars: number;
  errors: number;
  /**
   * How many characters past `correctChars` the cursor has been pushed by wrong keys. Each one
   * is drawn marked, and each one costs a Backspace. A count is enough: what is drawn is the
   * expected text, never what the player actually hit.
   */
  wrongStreak: number;
  /** Correct characters in a row right now. Resets to zero on any wrong key. */
  streak: number;
  /** The longest run of this race, kept because the current one is gone the moment it breaks. */
  bestStreak: number;
};

export const initialTypingState: TypingState = {
  correctChars: 0,
  errors: 0,
  wrongStreak: 0,
  streak: 0,
  bestStreak: 0,
};

export function isBlocked(state: TypingState): boolean {
  return state.wrongStreak > 0;
}

/**
 * Applies a single keystroke. Returns the same object when the key changes nothing, so callers
 * can skip a re-render, a sound and a network frame in one check.
 */
export function applyKey(state: TypingState, key: string, stream: string): TypingState {
  if (state.correctChars >= stream.length) return state;

  if (key === "Backspace") {
    if (state.wrongStreak === 0) return state;
    // One press per marked character. The screen shows how many are owed, so clearing them all
    // at once would contradict what the player is looking at.
    return { ...state, wrongStreak: state.wrongStreak - 1 };
  }

  // Only printable characters count; Shift, arrows, Enter and friends are ignored.
  if ([...key].length !== 1) return state;

  if (state.wrongStreak > 0) {
    if (state.wrongStreak >= MAX_WRONG_STREAK) return state;
    return { ...state, errors: state.errors + 1, wrongStreak: state.wrongStreak + 1 };
  }

  if (key === stream[state.correctChars]) {
    const streak = state.streak + 1;
    return {
      ...state,
      correctChars: state.correctChars + 1,
      streak,
      bestStreak: Math.max(state.bestStreak, streak),
    };
  }
  return { ...state, errors: state.errors + 1, wrongStreak: 1, streak: 0 };
}

/** Convenience for tests and for replaying a whole string of keystrokes. */
export function applyKeys(
  state: TypingState,
  keys: readonly string[],
  stream: string,
): TypingState {
  return keys.reduce((current, key) => applyKey(current, key, stream), state);
}
