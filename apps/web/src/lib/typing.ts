/**
 * Typing model for the race input.
 *
 * Error policy: strict. A wrong character never advances the player, and the passage on
 * screen is never rewritten with what they actually typed. This is what the platforms people
 * already know do: Monkeytype colours the *expected* character in the error colour and never
 * shows the mistyped glyph, and TypeRacer refuses to advance until the word matches. Injecting
 * the wrong characters into the text turns the thing the player is reading into a moving
 * target — exactly when they need it to stand still.
 *
 * Letting errors through and only docking accuracy is the other common option. It is rejected
 * here because progress and the passage would drift apart, and the server would have no way to
 * tell an honest mistake from a client silently skipping characters.
 *
 * Correct characters are never given back. Backspace only clears the error, which keeps client
 * progress monotonic and matching what the server accepts.
 */

/** Wrong keys at one position stop counting past this, so leaning on a key is not a death sentence. */
export const MAX_WRONG_STREAK = 8;

export type TypingState = {
  correctChars: number;
  errors: number;
  /**
   * Wrong keys pressed at the current position, waiting for a Backspace. Only a count: there
   * is nothing on screen to erase, so there is no text to keep.
   */
  wrongStreak: number;
};

export const initialTypingState: TypingState = { correctChars: 0, errors: 0, wrongStreak: 0 };

export function isBlocked(state: TypingState): boolean {
  return state.wrongStreak > 0;
}

export function isComplete(state: TypingState, passage: string): boolean {
  return state.correctChars >= passage.length;
}

/**
 * Applies a single keystroke. Returns the same object when the key changes nothing, so
 * callers can skip a re-render cheaply.
 */
export function applyKey(state: TypingState, key: string, passage: string): TypingState {
  if (isComplete(state, passage)) return state;

  if (key === "Backspace") {
    if (state.wrongStreak === 0) return state;
    // One press clears the whole block, however many wrong keys were pressed. Asking for one
    // Backspace per mistake would mean counting presses against something invisible.
    return { ...state, wrongStreak: 0 };
  }

  // Only printable characters count; Shift, arrows, Enter and friends are ignored.
  if ([...key].length !== 1) return state;

  if (state.wrongStreak > 0) {
    if (state.wrongStreak >= MAX_WRONG_STREAK) return state;
    return { ...state, errors: state.errors + 1, wrongStreak: state.wrongStreak + 1 };
  }

  const expected = passage[state.correctChars];
  if (key === expected) {
    return { ...state, correctChars: state.correctChars + 1 };
  }
  return { ...state, errors: state.errors + 1, wrongStreak: 1 };
}

/** Convenience for tests and for replaying a whole string of keystrokes. */
export function applyKeys(
  state: TypingState,
  keys: readonly string[],
  passage: string,
): TypingState {
  return keys.reduce((current, key) => applyKey(current, key, passage), state);
}
