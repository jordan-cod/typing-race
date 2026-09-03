import { useEffect, useState } from "react";
import { formatNumber } from "../lib/format.ts";

type Props = {
  value: number;
  decimals?: number;
  suffix?: string;
  reduced: boolean;
};

const DURATION_MS = 900;

/**
 * A number that arrives instead of appearing.
 *
 * The minute ends abruptly by design, so the result screen counts up to what you did: it gives
 * the eye somewhere to land and makes the final figure feel earned rather than pasted in.
 * Under reduced motion it is simply the number.
 */
export function CountUp({ value, decimals = 0, suffix = "", reduced }: Props) {
  const [shown, setShown] = useState(reduced ? value : 0);

  useEffect(() => {
    if (reduced) {
      setShown(value);
      return;
    }
    let frame = 0;
    const started = performance.now();
    const step = (now: number) => {
      const progress = Math.min((now - started) / DURATION_MS, 1);
      // Decelerating: fast enough to feel responsive, slow at the end so the last digits read.
      setShown(value * (1 - (1 - progress) ** 3));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, reduced]);

  return (
    <span className="tnum">
      {formatNumber(shown, decimals)}
      {suffix}
    </span>
  );
}
