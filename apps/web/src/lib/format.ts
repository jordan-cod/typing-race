/** Brazilian decimal comma. The interface is in Portuguese; the numbers should be too. */
export function formatNumber(value: number, decimals = 0): string {
  return value.toFixed(decimals).replace(".", ",");
}

/** Motorsport shorthand for a position on the board: P1, P2, P3. */
export function position(rank: number): string {
  return `P${rank}`;
}
