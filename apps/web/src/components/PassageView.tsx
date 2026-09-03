type Props = {
  passage: string;
  correctChars: number;
  hasError: boolean;
};

/**
 * The passage, never rewritten.
 *
 * A mistake marks the character the player *should* have typed, in place, instead of showing
 * the character they actually hit. That is how Monkeytype does it, and the reason is practical:
 * the text is what the player is reading from, so it has to stay still. Splicing the wrong
 * letters into it moves every following word sideways at the exact moment the player is trying
 * to find their place again.
 */
export function PassageView({ passage, correctChars, hasError }: Props) {
  const done = passage.slice(0, correctChars);
  const current = passage.slice(correctChars, correctChars + 1);
  const rest = passage.slice(correctChars + 1);

  return (
    <p className="font-mono text-xl leading-relaxed tracking-wide break-words whitespace-pre-wrap">
      <span className="text-accent">{done}</span>
      {current.length > 0 && (
        <span
          className={
            hasError
              ? "animate-error-shake rounded-sm bg-danger text-canvas"
              : "rounded-sm bg-ink/85 text-canvas"
          }
        >
          {/* A space is the character to type as often as any letter, and an empty
              highlight would look like the cursor vanished. */}
          {current === " " ? " " : current}
        </span>
      )}
      <span className="text-muted">{rest}</span>
    </p>
  );
}
