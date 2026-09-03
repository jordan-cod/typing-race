import { describe, expect, test } from "bun:test";
import {
  checkProgress,
  computeAccuracy,
  computeWpm,
  MAX_CHARS_PER_SECOND,
  PROGRESS_GRACE_CHARS,
  rankPlayers,
} from "@typing-race/protocol";

describe("computeWpm", () => {
  test("counts a word as five characters", () => {
    // 250 correct chars = 50 words, in exactly one minute.
    expect(computeWpm(250, 60_000)).toBe(50);
  });

  test("is zero before the clock moves", () => {
    expect(computeWpm(0, 0)).toBe(0);
    expect(computeWpm(100, 0)).toBe(0);
  });

  test("scales with elapsed time", () => {
    expect(computeWpm(250, 30_000)).toBe(100);
  });
});

describe("computeAccuracy", () => {
  test("is a share of every keystroke, right or wrong", () => {
    expect(computeAccuracy(90, 10)).toBe(90);
    expect(computeAccuracy(100, 0)).toBe(100);
  });

  test("starts at 100 before anything is typed", () => {
    expect(computeAccuracy(0, 0)).toBe(100);
  });

  test("drops to zero when nothing lands", () => {
    expect(computeAccuracy(0, 20)).toBe(0);
  });
});

describe("checkProgress", () => {
  const base = {
    previousChars: 0,
    nextChars: 0,
    previousErrors: 0,
    nextErrors: 0,
    passageLength: 120,
    elapsedMs: 10_000,
  };

  test("accepts a plausible human pace", () => {
    // 60 chars in 10s is about 144 WPM: fast, but real.
    expect(checkProgress({ ...base, nextChars: 60 })).toEqual({ ok: true });
  });

  test("rejects a pasted passage", () => {
    const pasted = checkProgress({ ...base, elapsedMs: 400, nextChars: 120 });
    expect(pasted).toEqual({ ok: false, reason: "impossible_speed" });
  });

  test("rejects a client claiming an impossible finish time", () => {
    const claim = checkProgress({
      ...base,
      previousChars: 119,
      nextChars: 120,
      elapsedMs: 200,
    });
    expect(claim).toEqual({ ok: false, reason: "impossible_speed" });
  });

  test("allows the grace window on the very first report", () => {
    expect(checkProgress({ ...base, elapsedMs: 0, nextChars: PROGRESS_GRACE_CHARS })).toEqual({
      ok: true,
    });
    expect(checkProgress({ ...base, elapsedMs: 0, nextChars: PROGRESS_GRACE_CHARS + 1 })).toEqual({
      ok: false,
      reason: "impossible_speed",
    });
  });

  test("sits right on the ceiling without rejecting", () => {
    const ceiling = PROGRESS_GRACE_CHARS + MAX_CHARS_PER_SECOND * 4;
    expect(checkProgress({ ...base, elapsedMs: 4_000, nextChars: ceiling })).toEqual({ ok: true });
    expect(checkProgress({ ...base, elapsedMs: 4_000, nextChars: ceiling + 1 })).toEqual({
      ok: false,
      reason: "impossible_speed",
    });
  });

  test("refuses to go backwards or past the end", () => {
    expect(checkProgress({ ...base, previousChars: 50, nextChars: 49 })).toEqual({
      ok: false,
      reason: "regressed",
    });
    expect(checkProgress({ ...base, nextChars: 121, elapsedMs: 600_000 })).toEqual({
      ok: false,
      reason: "beyond_passage",
    });
    expect(checkProgress({ ...base, previousErrors: 3, nextErrors: 1 })).toEqual({
      ok: false,
      reason: "errors_regressed",
    });
  });

  test("refuses fractional counts", () => {
    expect(checkProgress({ ...base, nextChars: 10.5 }).ok).toBe(false);
  });

  test("cumulative check catches a jump split across reports", () => {
    // Two 60-char reports 100ms apart: each delta looks small, the total does not.
    const first = checkProgress({ ...base, elapsedMs: 100, nextChars: 60 });
    expect(first.ok).toBe(false);
  });
});

describe("rankPlayers", () => {
  const entry = (over: Partial<Parameters<typeof rankPlayers>[0][number]>) => ({
    playerId: "p",
    nickname: "p",
    correctChars: 100,
    errors: 0,
    finishTimeMs: null,
    connected: true,
    ...over,
  });

  test("orders finishers by server-measured time", () => {
    const ranked = rankPlayers(
      [
        entry({ playerId: "b", nickname: "Bia", finishTimeMs: 31_000 }),
        entry({ playerId: "a", nickname: "Ana", finishTimeMs: 30_000 }),
      ],
      31_000,
    );
    expect(ranked.map((r) => r.playerId)).toEqual(["a", "b"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2]);
  });

  test("a photo finish is decided by accuracy, not by packet order", () => {
    const ranked = rankPlayers(
      [
        entry({ playerId: "sloppy", nickname: "Ana", finishTimeMs: 30_000, errors: 7 }),
        entry({ playerId: "clean", nickname: "Bia", finishTimeMs: 30_001, errors: 0 }),
      ],
      30_001,
    );
    // One millisecond apart: the clock still decides, it is a real difference.
    expect(ranked.map((r) => r.playerId)).toEqual(["sloppy", "clean"]);

    const dead = rankPlayers(
      [
        entry({ playerId: "sloppy", nickname: "Ana", finishTimeMs: 30_000, errors: 7 }),
        entry({ playerId: "clean", nickname: "Bia", finishTimeMs: 30_000, errors: 0 }),
      ],
      30_000,
    );
    expect(dead.map((r) => r.playerId)).toEqual(["clean", "sloppy"]);
    expect(dead.map((r) => r.rank)).toEqual([1, 2]);
  });

  test("a true tie shares the rank and pushes the next one down", () => {
    const ranked = rankPlayers(
      [
        entry({ playerId: "a", nickname: "Ana", finishTimeMs: 20_000, errors: 1 }),
        entry({ playerId: "b", nickname: "Bia", finishTimeMs: 20_000, errors: 1 }),
        entry({ playerId: "c", nickname: "Caio", finishTimeMs: 25_000 }),
      ],
      25_000,
    );
    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  test("unfinished players come after finishers, ordered by progress", () => {
    const ranked = rankPlayers(
      [
        entry({ playerId: "quit", nickname: "Ana", correctChars: 10, connected: false }),
        entry({ playerId: "slow", nickname: "Bia", correctChars: 80 }),
        entry({ playerId: "done", nickname: "Caio", correctChars: 120, finishTimeMs: 40_000 }),
      ],
      40_000,
    );
    expect(ranked.map((r) => r.playerId)).toEqual(["done", "slow", "quit"]);
  });

  test("scores an unfinished player over the full race duration", () => {
    const ranked = rankPlayers(
      [entry({ playerId: "a", correctChars: 250, errors: 50, finishTimeMs: null })],
      60_000,
    );
    expect(ranked[0]?.wpm).toBe(50);
    expect(ranked[0]?.accuracy).toBeCloseTo(83.3, 1);
  });
});
