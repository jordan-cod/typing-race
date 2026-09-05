import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { usePrefersReducedMotion } from "./reducedMotion.ts";

type Listener = () => void;

function stubMatchMedia(reduce: boolean) {
  const listeners = new Set<Listener>();
  const query = {
    matches: reduce,
    addEventListener: (_: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_: string, listener: Listener) => listeners.delete(listener),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn((text: string) => {
      expect(text).toContain("prefers-reduced-motion");
      return query;
    }),
  );
  return { query, listeners };
}

afterEach(() => vi.unstubAllGlobals());

describe("usePrefersReducedMotion", () => {
  test("reports the preference when it is set", () => {
    stubMatchMedia(true);
    expect(renderHook(() => usePrefersReducedMotion()).result.current).toBe(true);
  });

  test("reports false when it is not", () => {
    stubMatchMedia(false);
    expect(renderHook(() => usePrefersReducedMotion()).result.current).toBe(false);
  });

  test("stops listening when the component goes away", () => {
    const { listeners } = stubMatchMedia(false);
    const { unmount } = renderHook(() => usePrefersReducedMotion());
    expect(listeners.size).toBe(1);
    unmount();
    expect(listeners.size).toBe(0);
  });
});
