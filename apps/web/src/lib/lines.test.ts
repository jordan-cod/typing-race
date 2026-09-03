import { describe, expect, test } from "vitest";
import { columnAt, layoutLines, lineAt } from "./lines.ts";

const STREAM = "o gato subiu no telhado e ficou la o dia inteiro olhando a rua passar";

describe("layoutLines", () => {
  test("never splits a word", () => {
    const lines = layoutLines(STREAM, 20);
    lines.forEach((line, index) => {
      // A line always begins a word and ends after the space that closes one, so no line
      // starts or ends in the middle of something the player is reading. The last line is
      // the exception: it ends where the stream does.
      expect(STREAM[line.start - 1] ?? " ").toBe(" ");
      if (index < lines.length - 1) expect(STREAM[line.end - 1]).toBe(" ");
    });
  });

  test("respects the character budget", () => {
    for (const line of layoutLines(STREAM, 20)) {
      // The budget counts typed characters; the closing space may sit one past it.
      expect(line.text.trimEnd().length).toBeLessThanOrEqual(20);
    }
  });

  test("covers the whole stream with no gaps and no overlap", () => {
    const lines = layoutLines(STREAM, 24);
    expect(lines.map((line) => line.text).join("")).toBe(STREAM);
    lines.forEach((line, index) => {
      const previous = lines[index - 1];
      if (previous) expect(line.start).toBe(previous.end);
    });
    expect(lines.at(-1)?.end).toBe(STREAM.length);
  });

  test("keeps the space at the end of the line, where it is typed", () => {
    const lines = layoutLines(STREAM, 20);
    const first = lines[0];
    if (!first) throw new Error("no lines");
    expect(first.text.endsWith(" ")).toBe(true);
  });

  test("a word longer than the budget gets its own line rather than being cut", () => {
    const lines = layoutLines("ab supercalifragilistico cd", 10);
    expect(lines.some((line) => line.text.includes("supercalifragilistico"))).toBe(true);
    expect(lines.map((line) => line.text).join("")).toBe("ab supercalifragilistico cd");
  });

  test("handles an empty stream", () => {
    expect(layoutLines("", 40)).toEqual([]);
  });
});

describe("lineAt / columnAt", () => {
  const lines = layoutLines(STREAM, 20);

  test("finds the line holding a character", () => {
    expect(lineAt(lines, 0)).toBe(0);
    lines.forEach((line, index) => {
      expect(lineAt(lines, line.start)).toBe(index);
      expect(lineAt(lines, line.end - 1)).toBe(index);
    });
  });

  test("a column is the offset inside its own line", () => {
    lines.forEach((line) => {
      expect(columnAt(lines, line.start)).toBe(0);
      expect(columnAt(lines, line.start + 3)).toBe(3);
    });
  });

  test("past the last character it stays on the last line", () => {
    expect(lineAt(lines, STREAM.length + 50)).toBe(lines.length - 1);
  });
});
