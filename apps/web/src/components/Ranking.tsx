import type { PlayerSnapshot } from "@typing-race/protocol";
import { formatDuration, formatNumber, ordinal } from "../lib/format.ts";

type Props = {
  players: PlayerSnapshot[];
  selfId: string | null;
};

export function Ranking({ players, selfId }: Props) {
  const ranked = players
    .filter((player) => player.rank !== null)
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));

  return (
    <table className="w-full text-left text-sm">
      <thead className="text-xs uppercase tracking-wider text-muted">
        <tr>
          <th className="py-2 pr-2 font-medium">#</th>
          <th className="py-2 pr-2 font-medium">Jogador</th>
          <th className="py-2 pr-2 text-right font-medium">Tempo</th>
          <th className="py-2 pr-2 text-right font-medium">PPM</th>
          <th className="py-2 text-right font-medium">Precisao</th>
        </tr>
      </thead>
      <tbody>
        {ranked.map((player) => (
          <tr
            key={player.id}
            className={`border-t border-edge ${player.id === selfId ? "text-ink" : "text-muted"}`}
          >
            <td className="py-2.5 pr-2 tabular-nums">{ordinal(player.rank ?? 0)}</td>
            <td className="py-2.5 pr-2">
              {player.nickname}
              {player.id === selfId && " (voce)"}
              {!player.connected && <span className="ml-2 text-xs text-danger">saiu</span>}
            </td>
            <td className="py-2.5 pr-2 text-right tabular-nums">
              {player.finishTimeMs === null ? "nao terminou" : formatDuration(player.finishTimeMs)}
            </td>
            <td className="py-2.5 pr-2 text-right tabular-nums">{formatNumber(player.wpm, 1)}</td>
            <td className="py-2.5 text-right tabular-nums">{formatNumber(player.accuracy, 1)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
