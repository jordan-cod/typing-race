import { describe, expect, test } from "vitest";
import golden from "./stats.golden.json";
import { computeAccuracy, computeWpm } from "./stats.ts";

/**
 * The fixture is written by the Go test suite (`make protocol`). It is the only guard against
 * the browser's live counters and the server's final numbers slowly disagreeing.
 */
describe("live stats agree with the server", () => {
  for (const c of golden) {
    test(`${c.correctChars} correct and ${c.errors} wrong in ${c.elapsedMs}ms`, () => {
      expect(computeWpm(c.correctChars, c.elapsedMs)).toBe(c.wpm);
      expect(computeAccuracy(c.correctChars, c.errors)).toBe(c.accuracy);
    });
  }
});
