import { createRoute, Link } from "@tanstack/react-router";
import {
  COUNTDOWN_MS,
  NICKNAME_MAX_LENGTH,
  type RoomSnapshot,
  roomCodeSchema,
} from "@typing-race/protocol";
import { useEffect, useState } from "react";
import { RaceScreen } from "../components/RaceScreen.tsx";
import { Ranking } from "../components/Ranking.tsx";
import { loadNickname, saveNickname } from "../lib/session.ts";
import { useRace } from "../lib/useRace.ts";
import { rootRoute } from "./root.tsx";

function RoomPage() {
  const { code } = roomRoute.useParams();
  const [nickname, setNickname] = useState(loadNickname);

  const normalized = roomCodeSchema.safeParse(code);
  if (!normalized.success) {
    return <Message text="Codigo de sala invalido." />;
  }
  if (!nickname) {
    return <NicknameGate onConfirm={setNickname} />;
  }
  return (
    <ConnectedRoom
      key={nickname}
      code={normalized.data}
      nickname={nickname}
      onChangeNickname={setNickname}
    />
  );
}

function ConnectedRoom({
  code,
  nickname,
  onChangeNickname,
}: {
  code: string;
  nickname: string;
  onChangeNickname: (nickname: string) => void;
}) {
  const { status, playerId, room, error, send, serverNow } = useRace(code, nickname);

  // Two tabs of the same browser share the stored nickname, so this is the normal path when
  // someone opens a second window to test, not an edge case.
  if (error?.code === "nickname_taken") {
    return <NicknameGate onConfirm={onChangeNickname} error={error.message} />;
  }
  if (error?.fatal) {
    return (
      <div className="space-y-4">
        <Message text={error.message} tone="danger" />
        <Link to="/" className="text-accent underline">
          Voltar ao inicio
        </Link>
      </div>
    );
  }
  if (!room) {
    return <Message text={status === "closed" ? "Conexao perdida." : "Conectando..."} />;
  }

  return (
    <div className="space-y-6">
      {/* A rejected progress report is handled by resending, not by alarming the player. */}
      {error && !error.fatal && error.code !== "progress_rejected" && (
        <Message text={error.message} tone="danger" />
      )}
      {room.phase === "lobby" && <Lobby room={room} selfId={playerId} send={send} />}
      {room.phase === "countdown" && <Countdown room={room} serverNow={serverNow} />}
      {room.phase === "racing" && (
        <RaceScreen room={room} selfId={playerId} send={send} serverNow={serverNow} />
      )}
      {room.phase === "finished" && <Result room={room} selfId={playerId} send={send} />}
    </div>
  );
}

function Lobby({
  room,
  selfId,
  send,
}: {
  room: RoomSnapshot;
  selfId: string | null;
  send: ReturnType<typeof useRace>["send"];
}) {
  const [copied, setCopied] = useState(false);
  const self = room.players.find((player) => player.id === selfId);
  const isHost = self?.isHost ?? false;
  const racers = room.players.filter((player) => player.connected);
  const alone = racers.length < 2;
  const link = `${window.location.origin}/sala/${room.code}`;

  async function copyLink() {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-edge bg-surface p-5">
        <p className="text-sm text-muted">Codigo da sala</p>
        <p className="font-mono text-4xl tracking-[0.3em]">{room.code}</p>
        <button
          type="button"
          onClick={copyLink}
          className="mt-3 rounded-lg border border-edge px-3 py-1.5 text-sm"
        >
          {copied ? "Link copiado" : "Copiar link"}
        </button>
      </div>

      <div className="space-y-2 rounded-xl border border-edge bg-surface p-5">
        <h2 className="text-sm text-muted">Na sala ({racers.length})</h2>
        <ul className="divide-y divide-edge">
          {room.players.map((player) => (
            <li key={player.id} className="flex items-center justify-between py-2.5">
              <span>
                {player.nickname}
                {player.id === selfId && " (voce)"}
                {player.isHost && <span className="ml-2 text-xs text-muted">dono da sala</span>}
              </span>
              <span className={player.ready ? "text-sm text-accent" : "text-sm text-muted"}>
                {player.isHost ? "" : player.ready ? "pronto" : "aguardando"}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {isHost ? (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => send({ type: "start_race", solo: false })}
            disabled={alone}
            className="w-full rounded-lg bg-accent px-4 py-3 font-medium text-canvas disabled:opacity-40"
          >
            Comecar corrida
          </button>
          {alone && (
            <>
              <p className="text-sm text-muted">
                Chame mais alguem com o codigo ou treine sozinho.
              </p>
              <button
                type="button"
                onClick={() => send({ type: "start_race", solo: true })}
                className="w-full rounded-lg border border-edge px-4 py-3 text-sm"
              >
                Treinar sozinho, sem adversario
              </button>
            </>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => send({ type: "set_ready", ready: !self?.ready })}
          className="w-full rounded-lg border border-edge px-4 py-3 font-medium"
        >
          {self?.ready ? "Nao estou pronto" : "Estou pronto"}
        </button>
      )}
    </div>
  );
}

function Countdown({ room, serverNow }: { room: RoomSnapshot; serverNow: () => number }) {
  const [remaining, setRemaining] = useState(COUNTDOWN_MS);

  useEffect(() => {
    if (room.startAt === null) return;
    const startAt = room.startAt;
    const tick = () => setRemaining(startAt - serverNow());
    tick();
    const timer = setInterval(tick, 50);
    return () => clearInterval(timer);
  }, [room.startAt, serverNow]);

  const seconds = Math.ceil(remaining / 1000);
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-3">
      <p className="text-sm text-muted">Todo mundo comeca junto</p>
      <p className="font-mono text-8xl tabular-nums">{seconds > 0 ? seconds : "ja!"}</p>
    </div>
  );
}

function Result({
  room,
  selfId,
  send,
}: {
  room: RoomSnapshot;
  selfId: string | null;
  send: ReturnType<typeof useRace>["send"];
}) {
  const self = room.players.find((player) => player.id === selfId);
  const winner = room.players.find((player) => player.rank === 1);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          {winner ? `${winner.nickname} venceu` : "Corrida encerrada"}
        </h1>
        {self?.rank === 1 && <p className="text-sm text-accent">Voce ganhou.</p>}
      </div>

      <div className="rounded-xl border border-edge bg-surface p-5">
        <Ranking players={room.players} selfId={selfId} />
      </div>

      {self?.isHost ? (
        <button
          type="button"
          onClick={() => send({ type: "play_again" })}
          className="w-full rounded-lg bg-accent px-4 py-3 font-medium text-canvas"
        >
          Correr de novo
        </button>
      ) : (
        <p className="text-sm text-muted">Esperando o dono da sala comecar outra corrida.</p>
      )}
    </div>
  );
}

function NicknameGate({
  onConfirm,
  error,
}: {
  onConfirm: (nickname: string) => void;
  error?: string;
}) {
  const [value, setValue] = useState("");
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = value.trim();
        if (trimmed.length < 2) return;
        saveNickname(trimmed);
        onConfirm(trimmed);
      }}
    >
      <h1 className="text-2xl font-semibold">Escolha um apelido para entrar</h1>
      {error && <p className="text-sm text-danger">{error}</p>}
      <input
        className="w-full rounded-lg border border-edge bg-surface px-4 py-3 outline-none focus:border-accent"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        maxLength={NICKNAME_MAX_LENGTH}
        placeholder="Seu apelido"
        // biome-ignore lint/a11y/noAutofocus: the only field on the screen.
        autoFocus
      />
      <button
        type="submit"
        className="w-full rounded-lg bg-accent px-4 py-3 font-medium text-canvas"
      >
        Entrar na sala
      </button>
    </form>
  );
}

function Message({ text, tone = "muted" }: { text: string; tone?: "muted" | "danger" }) {
  return (
    <p
      className={`rounded-lg border border-edge bg-surface px-4 py-3 text-sm ${
        tone === "danger" ? "text-danger" : "text-muted"
      }`}
    >
      {text}
    </p>
  );
}

export const roomRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sala/$code",
  component: RoomPage,
});
