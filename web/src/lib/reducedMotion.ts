import { useEffect, useState } from "react";

/**
 * Whether the person asked their system to stop moving things.
 *
 * Read in JS as well as in CSS because some of the motion here is not a CSS animation: the
 * confetti is a canvas loop and the stream scroll is a transform driven by state, and neither
 * can be turned off by a media query alone.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => matches());

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reduced;
}

function matches(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
