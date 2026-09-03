import { useEffect, useMemo, useRef, useState } from "react";
import { columnAt, layoutLines, lineAt } from "../lib/lines.ts";

type Props = {
  stream: string;
  correctChars: number;
  /** Characters the cursor was pushed over by wrong keys. Each is drawn marked, each owes a Backspace. */
  wrongChars: number;
  reduced: boolean;
  /** The word just completed, in stream coordinates, so it can flash once where it sits. */
  flash: WordFlash | null;
};

/**
 * A finished word, frozen at the moment it was finished.
 *
 * The range is captured rather than recomputed from the cursor: the player keeps typing while
 * the flash plays out, and a range derived from the live cursor would slide onto the next word
 * halfway through the animation.
 */
export type WordFlash = { start: number; end: number; id: number };

/** Three lines is enough to read ahead without turning the screen into a wall of text. */
const VISIBLE_LINES = 3;
const LINE_HEIGHT = 46;
/** Long enough that sub-pixel rounding on one glyph does not skew the average. */
const SAMPLE = "0".repeat(50);

/**
 * The stream, three lines at a time.
 *
 * The live line stays in the same place on screen and the text slides underneath it. The
 * alternative — one long block with the cursor walking down it — is what makes people lose
 * their place: the eye has to re-find the cursor after every line break, and the whole page
 * reflows as the block grows.
 *
 * Wrapping is computed rather than left to the browser because the layout has to be
 * invertible: given a character index, which line and which column. That is what positions the
 * caret and what decides when to scroll.
 */
export function StreamView({ stream, correctChars, wrongChars, reduced, flash }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const sampleRef = useRef<HTMLSpanElement>(null);
  const [metrics, setMetrics] = useState({ charWidth: 0, boxWidth: 0 });

  useEffect(() => {
    const box = boxRef.current;
    const sample = sampleRef.current;
    if (!box || !sample) return;

    const measure = () => {
      const charWidth = sample.getBoundingClientRect().width / SAMPLE.length;
      const boxWidth = box.clientWidth;
      if (charWidth <= 0) return;
      setMetrics((previous) =>
        previous.charWidth === charWidth && previous.boxWidth === boxWidth
          ? previous
          : { charWidth, boxWidth },
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    // The web font lands after the first paint and every character gets a different width.
    void document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, []);

  const charsPerLine =
    metrics.charWidth > 0 ? Math.max(12, Math.floor(metrics.boxWidth / metrics.charWidth)) : 0;

  const lines = useMemo(
    () => (charsPerLine > 0 ? layoutLines(stream, charsPerLine) : []),
    [stream, charsPerLine],
  );

  // The caret sits after the marked run, not on the first mistake: that is where the next key
  // lands, and a caret parked behind the red would say the opposite.
  const cursor = correctChars + wrongChars;
  const active = lineAt(lines, cursor);
  const column = columnAt(lines, cursor);
  const activeLine = lines[active];
  // The first line sits at the top; from the second on, the live line holds the middle row.
  const scroll = Math.max(0, active - 1) * LINE_HEIGHT;

  return (
    <div
      ref={boxRef}
      className="relative overflow-hidden"
      style={{ height: VISIBLE_LINES * LINE_HEIGHT }}
    >
      <span
        ref={sampleRef}
        aria-hidden="true"
        className="stream invisible absolute top-0 left-0 text-2xl whitespace-pre"
      >
        {SAMPLE}
      </span>

      <div
        className="will-change-transform"
        style={{
          transform: `translateY(${-scroll}px)`,
          transition: reduced ? undefined : "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {lines.map((line, index) => (
          <div
            key={line.start}
            className="stream text-2xl whitespace-pre"
            style={{ height: LINE_HEIGHT, lineHeight: `${LINE_HEIGHT}px` }}
          >
            {index === active ? (
              <ActiveLine
                text={line.text}
                typed={correctChars - line.start}
                wrongChars={wrongChars}
                lineStart={line.start}
                flash={reduced ? null : flash}
              />
            ) : (
              <span className={index < active ? "text-dim/40" : "text-dim"}>{line.text}</span>
            )}
          </div>
        ))}

        {activeLine && metrics.charWidth > 0 && (
          <span
            aria-hidden="true"
            className={`absolute top-0 left-0 w-[2px] rounded-full ${
              wrongChars > 0 ? "bg-miss" : "bg-signal"
            }`}
            style={{
              height: LINE_HEIGHT * 0.62,
              transform: `translate3d(${column * metrics.charWidth}px, ${
                active * LINE_HEIGHT + LINE_HEIGHT * 0.19
              }px, 0)`,
              transition: reduced
                ? undefined
                : "transform 90ms cubic-bezier(0.22, 1, 0.36, 1), background-color 120ms",
            }}
          />
        )}
      </div>
    </div>
  );
}

function ActiveLine({
  text,
  typed,
  wrongChars,
  lineStart,
  flash,
}: {
  text: string;
  typed: number;
  wrongChars: number;
  lineStart: number;
  flash: WordFlash | null;
}) {
  const safe = Math.max(0, Math.min(typed, text.length));
  const done = text.slice(0, safe);
  // The marked run is the expected text, painted over — never the keys the player actually hit.
  const marked = text.slice(safe, safe + wrongChars);
  const rest = text.slice(safe + marked.length);

  // Only split the line when the finished word actually sits inside the part already typed on
  // it; a word that closed on the previous line has nothing to flash here.
  const from = flash === null ? -1 : flash.start - lineStart;
  const to = flash === null ? -1 : flash.end - lineStart;
  const split = from >= 0 && to <= safe;

  return (
    <>
      {split ? (
        <>
          <span className="text-paper">{done.slice(0, from)}</span>
          <span key={flash?.id} className="animate-word-pulse text-paper">
            {done.slice(from, to)}
          </span>
          <span className="text-paper">{done.slice(to)}</span>
        </>
      ) : (
        <span className="text-paper">{done}</span>
      )}
      {marked.length > 0 && (
        // A background, not just coloured type: a space typed wrong has no glyph to colour,
        // and it is as easy to get wrong as any letter.
        <span
          key={marked.length}
          className="animate-miss-shake inline-block rounded-[2px] bg-miss text-ink-900"
        >
          {marked}
        </span>
      )}
      <span className="text-dim">{rest}</span>
    </>
  );
}
