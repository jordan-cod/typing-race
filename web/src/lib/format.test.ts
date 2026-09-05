import { expect, test } from "vitest";
import { formatNumber, position } from "./format.ts";

test("formatNumber uses a decimal comma", () => {
  expect(formatNumber(83.34, 1)).toBe("83,3");
  expect(formatNumber(112)).toBe("112");
});

test("position reads like a timing board", () => {
  expect(position(1)).toBe("P1");
});
