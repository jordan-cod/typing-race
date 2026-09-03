import { describe, expect, test } from "vitest";
import { applyKey, applyKeys, initialTypingState, isBlocked, MAX_WRONG_STREAK } from "./typing.ts";

const PASSAGE = "ola mundo";

describe("applyKey", () => {
  test("advances one character at a time", () => {
    const state = applyKeys(initialTypingState, ["o", "l", "a"], PASSAGE);
    expect(state).toEqual({ correctChars: 3, errors: 0, wrongStreak: 0 });
  });

  test("a wrong character does not advance and blocks the input", () => {
    const state = applyKeys(initialTypingState, ["o", "x"], PASSAGE);
    expect(state.correctChars).toBe(1);
    expect(state.errors).toBe(1);
    expect(isBlocked(state)).toBe(true);
  });

  test("the right character while blocked does not let the player through", () => {
    const state = applyKeys(initialTypingState, ["o", "x", "l"], PASSAGE);
    expect(state.correctChars).toBe(1);
    expect(state.errors).toBe(2);
    expect(state.wrongStreak).toBe(2);
  });

  test("backspace clears the mistake and typing resumes", () => {
    const state = applyKeys(initialTypingState, ["o", "x", "Backspace", "l", "a"], PASSAGE);
    expect(state).toEqual({ correctChars: 3, errors: 1, wrongStreak: 0 });
  });

  // There is nothing on screen to erase, so counting one Backspace per wrong key would be
  // counting presses against something invisible.
  test("one backspace clears a whole streak of wrong keys", () => {
    const state = applyKeys(initialTypingState, ["o", "x", "y", "z", "Backspace"], PASSAGE);
    expect(isBlocked(state)).toBe(false);
    expect(state.errors).toBe(3);
    expect(applyKey(state, "l", PASSAGE).correctChars).toBe(2);
  });

  // The passage must read the same before and after a mistake: the model carries a count,
  // never the characters the player actually hit.
  test("keeps no record of what was typed wrong", () => {
    const state = applyKeys(initialTypingState, ["o", "x", "y"], PASSAGE);
    expect(Object.values(state).every((value) => typeof value === "number")).toBe(true);
  });

  test("backspace never gives back a correct character", () => {
    const typed = applyKeys(initialTypingState, ["o", "l", "a"], PASSAGE);
    expect(applyKey(typed, "Backspace", PASSAGE)).toBe(typed);
  });

  test("stops counting errors once the streak is long enough", () => {
    const wrong = Array.from({ length: MAX_WRONG_STREAK + 5 }, () => "x");
    const state = applyKeys(initialTypingState, wrong, PASSAGE);
    expect(state.errors).toBe(MAX_WRONG_STREAK);
    expect(state.wrongStreak).toBe(MAX_WRONG_STREAK);
  });

  test("ignores control keys and accepts accented characters", () => {
    const state = applyKeys(initialTypingState, ["Shift", "ArrowLeft", "Enter"], PASSAGE);
    expect(state).toBe(initialTypingState);
    expect(applyKey(initialTypingState, "ó", "ólá").correctChars).toBe(1);
  });

  test("nothing happens after the passage is finished", () => {
    const done = applyKeys(initialTypingState, [...PASSAGE], PASSAGE);
    expect(done.correctChars).toBe(PASSAGE.length);
    expect(applyKey(done, "x", PASSAGE)).toBe(done);
  });

  test("a clean run reports full accuracy input", () => {
    const done = applyKeys(initialTypingState, [...PASSAGE], PASSAGE);
    expect(done.errors).toBe(0);
  });
});
