import { describe, expect, test } from "bun:test";
import {
  applyOptions,
  buildStream,
  checkProgress,
  computeAccuracy,
  computeWpm,
  DEFAULT_STREAM_OPTIONS,
  MAX_CHARS_PER_SECOND,
  PASSAGES,
  PROGRESS_GRACE_CHARS,
  RACE_DURATION_MS,
  rankPlayers,
  STREAM_LENGTH,
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

describe("buildStream", () => {
  test("carries more text than the fastest possible minute", () => {
    const stream = buildStream(() => 0.5);
    const fastestPossible = (RACE_DURATION_MS / 1000) * MAX_CHARS_PER_SECOND;
    expect(stream.length).toBeGreaterThanOrEqual(STREAM_LENGTH);
    expect(stream.length).toBeGreaterThan(fastestPossible);
  });

  test("is continuous prose, not a list", () => {
    const stream = buildStream(() => 0.5);
    expect(stream).not.toContain("\n");
    expect(stream.trim()).toBe(stream);
  });

  test("is the same for everyone when the room builds it once", () => {
    // The room builds one stream and hands the same string to every player; two builds from
    // the same source of randomness must agree, or a replay would not be reproducible.
    const seeded = () => 0.42;
    expect(buildStream(seeded)).toBe(buildStream(seeded));
  });

  test("reuses the passages it has instead of inventing text", () => {
    const stream = buildStream(() => 0.5);
    const first = PASSAGES[0];
    if (!first) throw new Error("no passages");
    expect(stream).toContain(first.text);
  });
});

describe("checkProgress", () => {
  const base = {
    previousChars: 0,
    nextChars: 0,
    previousErrors: 0,
    nextErrors: 0,
    streamLength: STREAM_LENGTH,
    elapsedMs: 10_000,
  };

  test("accepts a plausible human pace", () => {
    // 60 chars in 10s is about 144 WPM: fast, but real.
    expect(checkProgress({ ...base, nextChars: 60 })).toEqual({ ok: true });
  });

  test("rejects a pasted block of text", () => {
    expect(checkProgress({ ...base, elapsedMs: 400, nextChars: 600 })).toEqual({
      ok: false,
      reason: "impossible_speed",
    });
  });

  test("rejects a client claiming an impossible minute", () => {
    // 1200 characters is a real 240 WPM minute; claiming it in two seconds is not.
    expect(checkProgress({ ...base, elapsedMs: 2_000, nextChars: 1_200 })).toEqual({
      ok: false,
      reason: "impossible_speed",
    });
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

  test("a whole minute at the ceiling is still accepted", () => {
    const most = PROGRESS_GRACE_CHARS + (RACE_DURATION_MS / 1000) * MAX_CHARS_PER_SECOND;
    expect(checkProgress({ ...base, elapsedMs: RACE_DURATION_MS, nextChars: most })).toEqual({
      ok: true,
    });
  });

  test("refuses to go backwards or past the end of the stream", () => {
    expect(checkProgress({ ...base, previousChars: 50, nextChars: 49 })).toEqual({
      ok: false,
      reason: "regressed",
    });
    expect(checkProgress({ ...base, nextChars: STREAM_LENGTH + 1, elapsedMs: 600_000 })).toEqual({
      ok: false,
      reason: "beyond_stream",
    });
    expect(checkProgress({ ...base, previousErrors: 3, nextErrors: 1 })).toEqual({
      ok: false,
      reason: "errors_regressed",
    });
  });

  test("refuses fractional counts", () => {
    expect(checkProgress({ ...base, nextChars: 10.5 }).ok).toBe(false);
  });

  test("the cumulative check catches a jump split across reports", () => {
    // Two 60-char reports 100ms apart: each delta looks small, the total does not.
    expect(checkProgress({ ...base, elapsedMs: 100, nextChars: 60 }).ok).toBe(false);
  });
});

describe("rankPlayers", () => {
  const entry = (over: Partial<Parameters<typeof rankPlayers>[0][number]>) => ({
    playerId: "p",
    nickname: "p",
    correctChars: 100,
    errors: 0,
    connected: true,
    ...over,
  });

  test("the most correct characters wins the minute", () => {
    const ranked = rankPlayers(
      [
        entry({ playerId: "b", nickname: "Bia", correctChars: 280 }),
        entry({ playerId: "a", nickname: "Ana", correctChars: 341 }),
      ],
      RACE_DURATION_MS,
    );
    expect(ranked.map((r) => r.playerId)).toEqual(["a", "b"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2]);
  });

  test("one character decides it, however close the minute was", () => {
    const ranked = rankPlayers(
      [
        entry({ playerId: "a", nickname: "Ana", correctChars: 300, errors: 0 }),
        entry({ playerId: "b", nickname: "Bia", correctChars: 301, errors: 40 }),
      ],
      RACE_DURATION_MS,
    );
    expect(ranked[0]?.playerId).toBe("b");
  });

  test("a dead heat on characters is broken by accuracy", () => {
    const ranked = rankPlayers(
      [
        entry({ playerId: "sloppy", nickname: "Ana", correctChars: 300, errors: 22 }),
        entry({ playerId: "clean", nickname: "Bia", correctChars: 300, errors: 3 }),
      ],
      RACE_DURATION_MS,
    );
    expect(ranked.map((r) => r.playerId)).toEqual(["clean", "sloppy"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2]);
  });

  test("identical on both numbers is a real tie and shares the rank", () => {
    const ranked = rankPlayers(
      [
        entry({ playerId: "a", nickname: "Ana", correctChars: 300, errors: 4 }),
        entry({ playerId: "b", nickname: "Bia", correctChars: 300, errors: 4 }),
        entry({ playerId: "c", nickname: "Caio", correctChars: 120 }),
      ],
      RACE_DURATION_MS,
    );
    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  test("the order never depends on which report arrived first", () => {
    const players = [
      entry({ playerId: "a", nickname: "Ana", correctChars: 300, errors: 4 }),
      entry({ playerId: "b", nickname: "Bia", correctChars: 300, errors: 9 }),
    ];
    const forwards = rankPlayers(players, RACE_DURATION_MS).map((r) => r.playerId);
    const backwards = rankPlayers([...players].reverse(), RACE_DURATION_MS).map((r) => r.playerId);
    expect(forwards).toEqual(backwards);
  });

  test("a player who dropped keeps the characters they typed", () => {
    const ranked = rankPlayers(
      [
        entry({ playerId: "quit", nickname: "Ana", correctChars: 90, connected: false }),
        entry({ playerId: "here", nickname: "Bia", correctChars: 60 }),
      ],
      RACE_DURATION_MS,
    );
    // Leaving does not forfeit: they simply stopped adding characters.
    expect(ranked.map((r) => r.playerId)).toEqual(["quit", "here"]);
  });

  test("scores everyone over the same minute", () => {
    const ranked = rankPlayers(
      [entry({ playerId: "a", correctChars: 250, errors: 50 })],
      RACE_DURATION_MS,
    );
    expect(ranked[0]?.wpm).toBe(50);
    expect(ranked[0]?.accuracy).toBeCloseTo(83.3, 1);
  });
});

describe("o texto da corrida", () => {
  const FRASE = "O café da manhã estava frio, mas ninguém reclamou!";

  test("sem acento, as letras continuam as mesmas", () => {
    expect(applyOptions(FRASE, { accents: false, punctuation: true })).toBe(
      "O cafe da manha estava frio, mas ninguem reclamou!",
    );
  });

  // A maiúscula existe porque uma frase começou, e a frase é o que a pontuação marcava.
  // Manter as maiúsculas sem a pontuação deixaria o Shift sem motivo na tela.
  test("sem pontuação, o texto também perde as maiúsculas", () => {
    expect(applyOptions(FRASE, { accents: true, punctuation: false })).toBe(
      "o café da manhã estava frio mas ninguém reclamou",
    );
  });

  test("sem os dois, sobra só letra e espaço", () => {
    expect(applyOptions(FRASE, { accents: false, punctuation: false })).toBe(
      "o cafe da manha estava frio mas ninguem reclamou",
    );
  });

  test("o padrão não mexe em nada", () => {
    expect(applyOptions(FRASE, DEFAULT_STREAM_OPTIONS)).toBe(FRASE);
  });

  // Tirar pontuação deixa espaços duplos onde a vírgula estava colada.
  test("não sobra espaço dobrado onde a pontuação saiu", () => {
    expect(applyOptions("a, b. c", { accents: true, punctuation: false })).toBe("a b c");
  });

  test("a corrida inteira respeita a escolha", () => {
    const stream = buildStream(() => 0.5, { accents: false, punctuation: false });
    expect(stream).not.toMatch(/[áéíóúãõçâêô.,;:!?]/);
  });

  // O texto-fonte é português correto; sem isso não existe modo "com acento".
  test("o padrão traz acento de verdade", () => {
    expect(buildStream(() => 0.5)).toMatch(/[áéíóúãõç]/);
  });
});
