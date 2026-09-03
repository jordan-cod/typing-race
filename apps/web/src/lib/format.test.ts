import { describe, expect, test } from "vitest";
import { formatDuration, formatNumber, ordinal } from "./format.ts";

describe("formatDuration", () => {
  test("seconds under a minute", () => {
    expect(formatDuration(12_340)).toBe("12,3s");
  });
  test("minutes and seconds", () => {
    expect(formatDuration(67_400)).toBe("1m 07,4s");
  });
});

test("formatNumber uses a decimal comma", () => {
  expect(formatNumber(83.34, 1)).toBe("83,3");
});

test("ordinal", () => {
  expect(ordinal(1)).toBe("1º");
});
