import type { PlayerSnapshot } from "@typing-race/protocol";
import { formatNumber } from "../lib/format.ts";

type Props = {
  player: PlayerSnapshot;
  isSelf: boolean;
};

export function PlayerLane({ player, isSelf }: Props) {
  const percent = Math.round(player.progress * 100);
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="flex items-center gap-2 truncate">
          <span className={isSelf ? "font-semibold text-ink" : "text-muted"}>
            {player.nickname}
            {isSelf && " (voce)"}
          </span>
          {!player.connected && <span className="text-xs text-danger">saiu</span>}
          {player.finishTimeMs !== null && <span className="text-xs text-accent">terminou</span>}
        </span>
        <span className="shrink-0 tabular-nums text-muted">
          {formatNumber(player.wpm)} ppm · {formatNumber(player.accuracy)}%
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-edge">
        <div
          className={`h-full rounded-full transition-[width] duration-150 ease-linear ${
            isSelf ? "bg-accent" : "bg-ink/45"
          } ${player.connected ? "" : "opacity-40"}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
