import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * Confetti for the winner, and only for the winner.
 *
 * A canvas rather than a few hundred animated DOM nodes, and it stops on its own: a
 * celebration that keeps going stops being one. Everyone else gets a clean result screen —
 * a consolation animation would be the interface patting you on the head.
 *
 * It goes through a portal to `document.body`, and it is measured from the viewport rather
 * than from itself. Both are on purpose. An ancestor carrying a `transform` becomes the
 * containing block for `position: fixed` children, so the result card's entrance animation
 * was enough to trap the whole thing inside it — and since the canvas measured its own box
 * on mount, in the middle of that animation, every piece was laid out for a rectangle the
 * size of the card. Rendering outside the tree means no wrapper anyone adds later can catch
 * it again.
 */
const PIECES = 90;
const DURATION_MS = 2_600;
const COLOURS = ["#f0b429", "#b57bee", "#5fd39a", "#f2eee3"];

type Piece = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  tilt: number;
  spin: number;
  colour: string;
};

export function Confetti() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.scale(ratio, ratio);

    const pieces: Piece[] = Array.from({ length: PIECES }, () => ({
      // Thrown from the top edge, spread across the width, like something tipped over.
      x: Math.random() * width,
      y: -20 - Math.random() * height * 0.4,
      vx: (Math.random() - 0.5) * 90,
      vy: 140 + Math.random() * 220,
      size: 4 + Math.random() * 6,
      tilt: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 7,
      colour: COLOURS[Math.floor(Math.random() * COLOURS.length)] ?? "#f2eee3",
    }));

    let frame = 0;
    let previous = performance.now();
    const started = previous;

    const draw = (now: number) => {
      const delta = Math.min((now - previous) / 1000, 0.05);
      previous = now;
      const life = (now - started) / DURATION_MS;
      if (life >= 1) return;

      context.clearRect(0, 0, width, height);
      context.globalAlpha = life > 0.7 ? 1 - (life - 0.7) / 0.3 : 1;

      for (const piece of pieces) {
        piece.x += piece.vx * delta;
        piece.y += piece.vy * delta;
        piece.vy += 220 * delta;
        piece.tilt += piece.spin * delta;

        context.save();
        context.translate(piece.x, piece.y);
        context.rotate(piece.tilt);
        context.fillStyle = piece.colour;
        context.fillRect(-piece.size / 2, -piece.size / 2, piece.size, piece.size * 0.6);
        context.restore();
      }

      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return createPortal(
    <canvas
      aria-hidden
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-50 h-screen w-screen"
    />,
    document.body,
  );
}
