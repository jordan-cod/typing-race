/**
 * Line layout for the stream.
 *
 * The stream arrives as one long string with no line breaks, and the race screen shows three
 * lines of it at a time. Wrapping is computed here instead of being left to the browser for
 * one reason: the player has to be able to keep their eyes still. Browser wrapping reflows
 * when the container changes and gives no way to ask "which line is character 412 on", which
 * is exactly what is needed to hold the live line in a fixed position and slide the text
 * underneath it.
 *
 * The font is monospaced, so a line is just a character budget and a column is just an index.
 * No measuring per glyph, no layout thrash.
 */

export type Line = {
  /** Index into the stream where the line starts. */
  start: number;
  /** Index one past the last character of the line, trailing space included. */
  end: number;
  text: string;
};

/**
 * Wraps the stream into lines of at most `charsPerLine` characters, never splitting a word.
 *
 * The space between two words belongs to the line of the word before it, because that is the
 * order it gets typed in: you finish the word, you press space, and only then does the next
 * line begin.
 */
export function layoutLines(stream: string, charsPerLine: number): Line[] {
  const budget = Math.max(8, Math.floor(charsPerLine));
  const lines: Line[] = [];
  let start = 0;
  let cursor = 0;

  while (cursor < stream.length) {
    const spaceAt = stream.indexOf(" ", cursor);
    // The trailing space is part of the token: it is a character the player has to type.
    const tokenEnd = spaceAt === -1 ? stream.length : spaceAt + 1;

    if (tokenEnd - start > budget && cursor > start) {
      lines.push({ start, end: cursor, text: stream.slice(start, cursor) });
      start = cursor;
    }
    cursor = tokenEnd;
  }

  if (start < stream.length) {
    lines.push({ start, end: stream.length, text: stream.slice(start, stream.length) });
  }
  return lines;
}

/**
 * Which line a character index sits on.
 *
 * A binary search, because this runs on every keystroke against a list that can be a hundred
 * lines long.
 */
export function lineAt(lines: readonly Line[], index: number): number {
  let low = 0;
  let high = lines.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const line = lines[middle];
    if (!line) break;
    if (index < line.start) high = middle - 1;
    else if (index >= line.end) low = middle + 1;
    else return middle;
  }
  // Past the last character: stay on the last line rather than scrolling into nothing.
  return Math.max(0, Math.min(lines.length - 1, low));
}

/** Column of a character index within its own line. */
export function columnAt(lines: readonly Line[], index: number): number {
  const line = lines[lineAt(lines, index)];
  if (!line) return 0;
  return Math.max(0, index - line.start);
}
