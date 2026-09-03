/** 1m 07,4s / 12,3s — Brazilian decimal comma, short enough to fit in a table cell. */
export function formatDuration(ms: number): string {
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1).replace(".", ",")}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}m ${seconds.toFixed(1).padStart(4, "0").replace(".", ",")}s`;
}

export function formatNumber(value: number, decimals = 0): string {
  return value.toFixed(decimals).replace(".", ",");
}

export function ordinal(rank: number): string {
  return `${rank}º`;
}
