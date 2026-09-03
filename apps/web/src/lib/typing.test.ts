import { describe, expect, test } from "vitest";
import { applyKey, applyKeys, initialTypingState, isBlocked, MAX_WRONG_STREAK } from "./typing.ts";

const STREAM = "ola mundo";

describe("applyKey", () => {
  test("advances one character at a time", () => {
    const state = applyKeys(initialTypingState, ["o", "l", "a"], STREAM);
    expect(state).toMatchObject({ correctChars: 3, errors: 0, wrongStreak: 0 });
  });

  test("a wrong key does not advance and blocks the input", () => {
    const state = applyKeys(initialTypingState, ["o", "x"], STREAM);
    expect(state.correctChars).toBe(1);
    expect(state.errors).toBe(1);
    expect(isBlocked(state)).toBe(true);
  });

  test("the right character while blocked does not sneak through", () => {
    const state = applyKeys(initialTypingState, ["o", "x", "l"], STREAM);
    expect(state.correctChars).toBe(1);
    expect(state.errors).toBe(2);
    expect(state.wrongStreak).toBe(2);
  });

  // What is on screen is the count of Backspaces owed, so two mistakes have to cost two.
  test("backspace clears one marked character per press", () => {
    const dois = applyKeys(initialTypingState, ["o", "x", "x"], STREAM);
    expect(dois.wrongStreak).toBe(2);

    const um = applyKey(dois, "Backspace", STREAM);
    expect(um.wrongStreak).toBe(1);

    const limpo = applyKey(um, "Backspace", STREAM);
    expect(limpo.wrongStreak).toBe(0);
    expect(applyKeys(limpo, ["l", "a"], STREAM)).toMatchObject({
      correctChars: 3,
      errors: 2,
      wrongStreak: 0,
    });
  });

  test("backspace never gives back a correct character", () => {
    const typed = applyKeys(initialTypingState, ["o", "l", "a"], STREAM);
    expect(applyKey(typed, "Backspace", STREAM)).toBe(typed);
  });

  test("stops counting errors once the block is deep enough", () => {
    const wrong = Array.from({ length: MAX_WRONG_STREAK + 5 }, () => "x");
    const state = applyKeys(initialTypingState, wrong, STREAM);
    expect(state.errors).toBe(MAX_WRONG_STREAK);
    // The marked run stops growing too, so it never swallows the line still to be read.
    expect(state.wrongStreak).toBe(MAX_WRONG_STREAK);
  });

  // The cursor is pushed over the expected characters; correct progress does not move.
  test("wrong keys move the cursor without counting as progress", () => {
    const state = applyKeys(initialTypingState, ["o", "x", "x"], STREAM);
    expect(state.correctChars).toBe(1);
    expect(state.correctChars + state.wrongStreak).toBe(3);
  });

  test("ignores control keys and accepts accented characters", () => {
    expect(applyKeys(initialTypingState, ["Shift", "ArrowLeft", "Enter"], STREAM)).toBe(
      initialTypingState,
    );
    expect(applyKey(initialTypingState, "ó", "ólá").correctChars).toBe(1);
  });

  test("nothing happens once the stream is exhausted", () => {
    const done = applyKeys(initialTypingState, [...STREAM], STREAM);
    expect(applyKey(done, "x", STREAM)).toBe(done);
  });
});

describe("streaks", () => {
  test("builds with every correct character", () => {
    expect(applyKeys(initialTypingState, ["o", "l", "a"], STREAM).streak).toBe(3);
  });

  test("breaks on a wrong key", () => {
    const state = applyKeys(initialTypingState, ["o", "l", "a", "x"], STREAM);
    expect(state.streak).toBe(0);
  });

  test("remembers the longest run of the race", () => {
    const state = applyKeys(initialTypingState, ["o", "l", "a", "x", "Backspace", " "], STREAM);
    expect(state.streak).toBe(1);
    expect(state.bestStreak).toBe(3);
  });

  test("a blocked keystroke does not revive the streak", () => {
    const state = applyKeys(initialTypingState, ["o", "x", "l", "Backspace", "Backspace"], STREAM);
    expect(state.streak).toBe(0);
  });
});
