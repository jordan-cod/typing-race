import { describe, expect, test } from "vitest";
import { applyKey, applyKeys, initialTypingState, isBlocked, MAX_PENDING } from "./typing.ts";

const PASSAGE = "ola mundo";

describe("applyKey", () => {
  test("advances one character at a time", () => {
    const state = applyKeys(initialTypingState, ["o", "l", "a"], PASSAGE);
    expect(state).toEqual({ correctChars: 3, errors: 0, pending: "" });
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
    expect(state.pending).toBe("xl");
  });

  test("backspace clears the mistake and typing resumes", () => {
    const state = applyKeys(initialTypingState, ["o", "x", "Backspace", "l", "a"], PASSAGE);
    expect(state).toEqual({ correctChars: 3, errors: 1, pending: "" });
  });

  test("backspace never gives back a correct character", () => {
    const typed = applyKeys(initialTypingState, ["o", "l", "a"], PASSAGE);
    expect(applyKey(typed, "Backspace", PASSAGE)).toBe(typed);
  });

  test("stops counting errors once the buffer is full", () => {
    const wrong = Array.from({ length: MAX_PENDING + 5 }, () => "x");
    const state = applyKeys(initialTypingState, wrong, PASSAGE);
    expect(state.errors).toBe(MAX_PENDING);
    expect(state.pending).toHaveLength(MAX_PENDING);
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
