/**
 * Typing model for the race input.
 *
 * Error policy: strict. A wrong character never advances the player; it goes into a small
 * buffer that has to be erased with Backspace before typing can continue. The alternative
 * (letting errors through and only docking accuracy) makes progress and the passage drift
 * apart, and the server would have no way to tell an honest mistake from a client silently
 * skipping characters. Every wrong keystroke still counts against accuracy, so the mistake
 * is paid for twice: in time and in the final percentage.
 *
 * Correct characters are never given back. Backspace only erases the pending mistakes, which
 * keeps client progress monotonic and matching what the server accepts.
 */

/** Once this many wrong characters are pending, further keys are ignored instead of counted. */
export const MAX_PENDING = 8;

export type TypingState = {
  correctChars: number;
  errors: number;
  /** Wrong characters typed since the last correct one; they must be erased to continue. */
  pending: string;
};

export const initialTypingState: TypingState = { correctChars: 0, errors: 0, pending: "" };

export function isBlocked(state: TypingState): boolean {
  return state.pending.length > 0;
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
    if (state.pending.length === 0) return state;
    return { ...state, pending: state.pending.slice(0, -1) };
  }

  // Only printable characters count; Shift, arrows, Enter and friends are ignored.
  if ([...key].length !== 1) return state;

  if (state.pending.length > 0) {
    // Already stuck: stop inflating the error count once the buffer is full, otherwise a
    // player who leans on a key ends the race with an absurd accuracy penalty.
    if (state.pending.length >= MAX_PENDING) return state;
    return { ...state, errors: state.errors + 1, pending: state.pending + key };
  }

  const expected = passage[state.correctChars];
  if (key === expected) {
    return { ...state, correctChars: state.correctChars + 1 };
  }
  return { ...state, errors: state.errors + 1, pending: key };
}

/** Convenience for tests and for replaying a whole string of keystrokes. */
export function applyKeys(
  state: TypingState,
  keys: readonly string[],
  passage: string,
): TypingState {
  return keys.reduce((current, key) => applyKey(current, key, passage), state);
}
