import { formatNumber, position } from "../lib/format.ts";
import type { PersonalBest } from "../lib/personalBest.ts";
import type { PlayerSnapshot, RoomSnapshot } from "../protocol/index.ts";
import { Confetti } from "./Confetti.tsx";
import { CountUp } from "./CountUp.tsx";

type Props = {
  room: RoomSnapshot;
  selfId: string | null;
  previousBest: PersonalBest | null;
  beatBest: boolean;
  bestStreak: number;
  reduced: boolean;
  onPlayAgain: () => void;
};

export function Result({
  room,
  selfId,
  previousBest,
  beatBest,
  bestStreak,
  reduced,
  onPlayAgain,
}: Props) {
  const ranked = room.players
    .filter((player) => player.rank !== null)
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  const self = ranked.find((player) => player.id === selfId);
  const winners = ranked.filter((player) => player.rank === 1);
  const iWon = self?.rank === 1;

  return (
    <div className={`space-y-8 ${reduced ? "" : "animate-land"}`}>
      {iWon && !reduced && <Confetti />}

      <header className="space-y-1">
        <h1 className="font-display text-4xl font-semibold tracking-tight">
          {iWon ? "Você venceu" : headline(winners)}
        </h1>
        {beatBest ? (
          <p className="text-gain">
            Novo recorde seu
            {previousBest ? `, antes era ${formatNumber(previousBest.wpm)} ppm` : ""}.
          </p>
        ) : (
          previousBest && (
            <p className="text-dim">Seu recorde: {formatNumber(previousBest.wpm)} ppm.</p>
          )
        )}
      </header>

      {self && (
        <div className="flex flex-wrap gap-x-12 gap-y-5">
          <BigStat label="ppm">
            <CountUp value={self.wpm} decimals={1} reduced={reduced} />
          </BigStat>
          <BigStat label="precisão">
            <CountUp value={self.accuracy} decimals={1} suffix="%" reduced={reduced} />
          </BigStat>
          <BigStat label="caracteres">
            <CountUp value={self.correctChars} reduced={reduced} />
          </BigStat>
          <BigStat label="melhor sequência">
            <CountUp value={bestStreak} reduced={reduced} />
          </BigStat>
        </div>
      )}

      <div className="border-t border-ink-700" />

      <table className="w-full text-left text-sm">
        <thead className="text-dim">
          <tr>
            <th className="pb-2 font-normal">#</th>
            <th className="pb-2 font-normal">jogador</th>
            <th className="pb-2 text-right font-normal">caracteres</th>
            <th className="pb-2 text-right font-normal">ppm</th>
            <th className="pb-2 text-right font-normal">precisão</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((player) => (
            <tr key={player.id} className={player.id === selfId ? "text-paper" : "text-dim"}>
              <td className={`tnum py-2.5 ${player.rank === 1 ? "text-best" : ""}`}>
                {position(player.rank ?? 0)}
              </td>
              <td className="py-2.5">
                {player.id === selfId ? "você" : player.nickname}
                {!player.connected && <span className="ml-2 text-xs text-miss">saiu</span>}
              </td>
              <td className="tnum py-2.5 text-right">{player.correctChars}</td>
              <td className="tnum py-2.5 text-right">{formatNumber(player.wpm, 1)}</td>
              <td className="tnum py-2.5 text-right">{formatNumber(player.accuracy, 1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>

      {self?.isHost ? (
        <button
          type="button"
          onClick={onPlayAgain}
          className="w-full bg-signal py-3.5 font-display font-semibold text-ink-900 hover:bg-signal/90 sm:w-auto sm:px-10"
        >
          Correr de novo
        </button>
      ) : (
        <p className="text-dim">Esperando quem criou a sala começar outra.</p>
      )}
    </div>
  );
}

function headline(winners: PlayerSnapshot[]): string {
  if (winners.length === 0) return "Corrida encerrada";
  if (winners.length === 1) return `${winners[0]?.nickname} venceu`;
  // A genuine tie: same characters, same mistakes.
  return `Empate entre ${winners.map((player) => player.nickname).join(" e ")}`;
}

function BigStat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-display text-5xl font-semibold tracking-tight tabular-nums">
        {children}
      </div>
      <div className="mt-1 text-sm text-dim">{label}</div>
    </div>
  );
}
