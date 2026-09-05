/**
 * The player's own record, kept in this browser.
 *
 * There are no accounts, so there is nowhere else to put it — and there does not need to be.
 * Every race is the same fixed minute, which is what makes two results comparable at all and
 * a personal best meaningful rather than a number that depends on the passage you drew.
 */

const STORAGE_KEY = "typing-race:best";

export type PersonalBest = {
  wpm: number;
  accuracy: number;
  /** Epoch ms, so the result screen can say how long the old record stood. */
  at: number;
};

export function loadPersonalBest(): PersonalBest | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { wpm, accuracy, at } = parsed as Record<string, unknown>;
    if (typeof wpm !== "number" || typeof accuracy !== "number" || typeof at !== "number") {
      return null;
    }
    return { wpm, accuracy, at };
  } catch {
    // Someone edited localStorage by hand, or an older version wrote a different shape.
    return null;
  }
}

export function savePersonalBest(best: PersonalBest): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(best));
}

/** Speed is the record. Accuracy is reported next to it, but it does not gate the record. */
export function beatsPersonalBest(candidate: number, best: PersonalBest | null): boolean {
  return best === null ? candidate > 0 : candidate > best.wpm;
}
