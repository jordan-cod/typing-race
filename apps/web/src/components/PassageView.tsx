type Props = {
  passage: string;
  correctChars: number;
  pending: string;
};

/**
 * The passage with three zones: what is already typed, the wrong characters waiting to be
 * erased, and what is left. Rendering the pending mistakes inline makes it obvious why the
 * cursor stopped moving.
 */
export function PassageView({ passage, correctChars, pending }: Props) {
  const done = passage.slice(0, correctChars);
  const rest = passage.slice(correctChars);
  const nextChar = rest.slice(0, 1);

  return (
    <p className="font-mono text-xl leading-relaxed tracking-wide break-words whitespace-pre-wrap">
      <span className="text-accent">{done}</span>
      {pending.length > 0 && (
        <span className="rounded-sm bg-danger/30 text-danger underline decoration-danger">
          {pending}
        </span>
      )}
      {pending.length === 0 && nextChar.length > 0 && (
        <span className="rounded-sm bg-ink/85 text-canvas">{nextChar}</span>
      )}
      <span className="text-muted">{pending.length === 0 ? rest.slice(1) : rest}</span>
    </p>
  );
}
