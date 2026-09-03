import type { PlayerSnapshot } from "@typing-race/protocol";
import { position } from "../lib/format.ts";

type Props = {
  players: PlayerSnapshot[];
  selfId: string | null;
};

/**
 * The other lanes, as a timing board.
 *
 * Bars are scaled against the leader, not against the text: the stream has no end, so "how far
 * along am I" is not a question this race can answer. "How far behind the leader am I" is the
 * only one that matters while the clock runs, and it is the one the bar shows.
 */
export function Lanes({ players, selfId }: Props) {
  const racers = players.filter((player) => !player.spectator);
  const leader = Math.max(1, ...racers.map((player) => player.correctChars));

  return (
    <ul className="space-y-3">
      {[...racers]
        .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
        .map((player) => {
          const isSelf = player.id === selfId;
          return (
            <li
              key={player.id}
              className="grid grid-cols-[1.9rem_5.5rem_1fr_2.8rem] items-center gap-3 sm:grid-cols-[2.2rem_7rem_1fr_3.2rem] sm:gap-4"
            >
              <span className={`tnum text-sm ${player.rank === 1 ? "text-best" : "text-dim"}`}>
                {player.rank === null ? "" : position(player.rank)}
              </span>

              <span
                className={`truncate text-sm ${isSelf ? "text-paper" : "text-dim"} ${
                  player.connected ? "" : "line-through decoration-miss"
                }`}
              >
                {isSelf ? "você" : player.nickname}
              </span>

              {/* A 2px rule that fills, not a container: the lane is the distance itself. */}
              <span className="relative block h-[2px] bg-ink-700">
                <span
                  className={`absolute inset-y-0 left-0 ${isSelf ? "bg-signal" : "bg-dim"} ${
                    player.connected ? "" : "opacity-40"
                  }`}
                  style={{
                    width: `${Math.max((player.correctChars / leader) * 100, 0.5)}%`,
                    transition: "width 200ms linear",
                  }}
                />
              </span>

              <span className={`tnum text-right text-sm ${isSelf ? "text-paper" : "text-dim"}`}>
                {player.correctChars}
              </span>
            </li>
          );
        })}
    </ul>
  );
}
