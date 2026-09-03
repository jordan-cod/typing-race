import { createRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import {
  NICKNAME_MAX_LENGTH,
  ROOM_CODE_LENGTH,
  type RoomSnapshot,
  roomCodeSchema,
} from "@typing-race/protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RaceScreen } from "../components/RaceScreen.tsx";
import { Result } from "../components/Result.tsx";
import { formatNumber } from "../lib/format.ts";
import {
  beatsPersonalBest,
  loadPersonalBest,
  type PersonalBest,
  savePersonalBest,
} from "../lib/personalBest.ts";
import { usePrefersReducedMotion } from "../lib/reducedMotion.ts";
import { loadNickname, saveNickname } from "../lib/session.ts";
import { Keyboard, loadMuted, saveMuted, type Voice } from "../lib/sound.ts";
import { initialTypingState, type TypingState } from "../lib/typing.ts";
import { useRace } from "../lib/useRace.ts";
import { rootRoute } from "./root.tsx";

function RoomPage() {
  const { code } = roomRoute.useParams();
  const [nickname, setNickname] = useState(loadNickname);

  // Na raiz só existem a home e um código de sala, então qualquer outra coisa é um código
  // errado — e quem digitou precisa de uma saída, não só do diagnóstico.
  const normalized = roomCodeSchema.safeParse(code);
  if (!normalized.success) {
    return (
      <div className="space-y-5">
        <Notice tone="miss">
          <span className="stream">{code}</span> não parece um código de sala. São{" "}
          {ROOM_CODE_LENGTH} caracteres, sem O, I, zero ou um.
        </Notice>
        <Link to="/" className="text-signal underline underline-offset-4">
          Voltar ao início
        </Link>
      </div>
    );
  }
  if (!nickname) return <NicknameGate onConfirm={setNickname} />;

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
  const { status, reconnect, playerId, room, stream, error, send, serverNow } = useRace(
    code,
    nickname,
  );
  const navigate = useNavigate();

  // Sair é só ir embora: desmontar fecha o socket, e o servidor já sabe o que fazer com quem
  // sai — some do lobby, e no meio de uma corrida a pista fica com o que a pessoa digitou.
  const onLeave = useCallback(() => {
    navigate({ to: "/" });
  }, [navigate]);
  const reduced = usePrefersReducedMotion();

  const keyboard = useMemo(() => new Keyboard(), []);
  const [muted, setMuted] = useState(loadMuted);
  useEffect(() => () => keyboard.close(), [keyboard]);

  // The write happens here rather than inside the state updater: React is allowed to run an
  // updater more than once, so it is no place for anything that touches the outside world.
  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next);
    saveMuted(next);
    if (!next) keyboard.unlock();
  }, [keyboard, muted]);

  // Muting cuts the sound at the source rather than at every call site.
  const voice: Voice = useMemo(
    () => ({
      unlock: () => {
        if (!muted) keyboard.unlock();
      },
      play: (kind) => {
        if (!muted) keyboard.play(kind);
      },
    }),
    [keyboard, muted],
  );

  const [typing, setTyping] = useState<TypingState>(initialTypingState);
  const [personalBest, setPersonalBest] = useState<PersonalBest | null>(loadPersonalBest);
  const [previousBest, setPreviousBest] = useState<PersonalBest | null>(null);
  const [beatBest, setBeatBest] = useState(false);
  const recordedRaceRef = useRef<number | null>(null);

  // Reset the local typing state whenever a new race starts, so a second race does not open
  // with the last one's characters still counted.
  const startAt = room?.startAt ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: startAt is the trigger, not an input
  useEffect(() => {
    setTyping(initialTypingState);
  }, [startAt]);

  const self = room?.players.find((player) => player.id === playerId) ?? null;
  const phase = room?.phase;
  const endedAt = room?.endedAt ?? null;

  // The record is written from the server's numbers, not the browser's, and only once per race.
  useEffect(() => {
    if (phase !== "finished" || endedAt === null || !self || self.spectator) return;
    if (recordedRaceRef.current === endedAt) return;
    recordedRaceRef.current = endedAt;

    const current = loadPersonalBest();
    setPreviousBest(current);
    if (beatsPersonalBest(self.wpm, current)) {
      const record = { wpm: self.wpm, accuracy: self.accuracy, at: Date.now() };
      savePersonalBest(record);
      setPersonalBest(record);
      setBeatBest(true);
    } else {
      setBeatBest(false);
    }
  }, [phase, endedAt, self]);

  if (error?.code === "nickname_taken") {
    return <NicknameGate onConfirm={onChangeNickname} error={error.message} />;
  }
  if (error?.fatal) {
    return (
      <div className="space-y-5">
        <Notice tone="miss">{error.message}</Notice>
        <div className="flex flex-wrap items-center gap-5">
          <button
            type="button"
            onClick={reconnect}
            className="bg-signal px-6 py-2.5 font-display font-semibold text-ink-900"
          >
            Tentar entrar de novo
          </button>
          <Link to="/" className="text-dim underline underline-offset-4 hover:text-paper">
            Voltar ao início
          </Link>
        </div>
      </div>
    );
  }
  if (!room) {
    return status === "closed" ? (
      <div className="space-y-5">
        {/* A tentativa automática já está correndo; o botão é para quem não quer esperar. */}
        <Notice tone="miss">Conexão perdida. Tentando voltar…</Notice>
        <button
          type="button"
          onClick={reconnect}
          className="bg-signal px-6 py-2.5 font-display font-semibold text-ink-900"
        >
          Tentar agora
        </button>
      </div>
    ) : (
      <Notice>Conectando…</Notice>
    );
  }

  return (
    <div className="space-y-6">
      {status === "closed" && (
        <Notice tone="miss">Conexão perdida. Tentando voltar para a sala…</Notice>
      )}

      {error && !error.fatal && error.code !== "progress_rejected" && (
        <Notice tone="miss">{error.message}</Notice>
      )}

      {room.phase === "lobby" && (
        <Lobby
          room={room}
          selfId={playerId}
          personalBest={personalBest}
          onStart={(solo) => {
            // Unlocking audio here rides the click the browser requires for it.
            if (!muted) keyboard.unlock();
            send({ type: "start_race", solo });
          }}
          onReady={(ready) => {
            if (!muted) keyboard.unlock();
            send({ type: "set_ready", ready });
          }}
        />
      )}

      {room.phase === "countdown" && (
        <Countdown room={room} serverNow={serverNow} reduced={reduced} />
      )}

      {room.phase === "racing" && (
        <RaceScreen
          room={room}
          stream={stream}
          selfId={playerId}
          send={send}
          serverNow={serverNow}
          keyboard={voice}
          muted={muted}
          onToggleMute={toggleMute}
          personalBest={personalBest}
          reduced={reduced}
          onTypingChange={setTyping}
        />
      )}

      {room.phase === "finished" && (
        <Result
          room={room}
          selfId={playerId}
          previousBest={previousBest}
          beatBest={beatBest}
          bestStreak={typing.bestStreak}
          reduced={reduced}
          onPlayAgain={() => send({ type: "play_again" })}
        />
      )}

      {/* Sair fica no rodapé da sala, e não junto do botão de começar: é a saída, não uma
          das ações do jogo. Durante a corrida ela some — quem quer sair no meio de um minuto
          fecha a aba, e um botão de abandonar ao lado do texto é um clique de arrependimento
          esperando acontecer. */}
      {room.phase !== "racing" && room.phase !== "countdown" && (
        <div className="border-t border-ink-700 pt-5">
          <button
            type="button"
            onClick={onLeave}
            className="text-sm text-dim underline underline-offset-4 hover:text-paper"
          >
            Sair da sala
          </button>
        </div>
      )}
    </div>
  );
}

function Lobby({
  room,
  selfId,
  personalBest,
  onStart,
  onReady,
}: {
  room: RoomSnapshot;
  selfId: string | null;
  personalBest: PersonalBest | null;
  onStart: (solo: boolean) => void;
  onReady: (ready: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);
  const self = room.players.find((player) => player.id === selfId);
  const present = room.players.filter((player) => player.connected);
  const alone = present.length < 2;
  // Quem criou a sala não marca "pronto": começar é o pronto dele.
  const faltam = present.filter((player) => !player.isHost && !player.ready);
  const podeComecar = !alone && faltam.length === 0;

  async function copyLink() {
    await navigator.clipboard.writeText(`${window.location.origin}/${room.code}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-sm text-dim">Chame alguém com este código</p>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <span className="stream text-5xl font-medium tracking-[0.28em] text-signal">
            {room.code}
          </span>
          <button
            type="button"
            onClick={copyLink}
            className="text-sm text-dim underline underline-offset-4 hover:text-paper"
          >
            {copied ? "link copiado" : "copiar link"}
          </button>
        </div>
      </header>

      <div className="border-t border-ink-700" />

      <ul className="space-y-3">
        {room.players.map((player) => (
          <li key={player.id} className="flex items-baseline justify-between gap-4">
            <span className={player.id === selfId ? "text-paper" : "text-dim"}>
              {player.nickname}
              {player.id === selfId && " (você)"}
              {player.isHost && <span className="ml-3 text-sm text-dim">criou a sala</span>}
            </span>
            {!player.isHost && (
              <span className={player.ready ? "text-sm text-gain" : "text-sm text-dim"}>
                {player.ready ? "pronto" : "aguardando"}
              </span>
            )}
          </li>
        ))}
      </ul>

      <div className="border-t border-ink-700" />

      <div className="space-y-4">
        {self?.isHost ? (
          <>
            <button
              type="button"
              onClick={() => onStart(false)}
              disabled={!podeComecar}
              className="w-full bg-signal py-3.5 font-display font-semibold text-ink-900 disabled:bg-ink-800 disabled:text-dim sm:w-auto sm:px-10"
            >
              Começar corrida
            </button>

            {/* Um botão desabilitado sem motivo é uma parede. Diz quem falta, pelo nome, para
                o dono da sala saber de quem cobrar em vez de ficar clicando. */}
            {!alone && faltam.length > 0 && (
              <p className="text-sm text-dim">
                {faltam.length === 1
                  ? `Esperando ${faltam[0]?.nickname} ficar pronto.`
                  : `Esperando ${faltam.map((player) => player.nickname).join(", ")} ficarem prontos.`}
              </p>
            )}
            {alone && (
              <p className="text-sm text-dim">
                Ninguém mais na sala.{" "}
                <button
                  type="button"
                  onClick={() => onStart(true)}
                  className="text-paper underline underline-offset-4"
                >
                  Treinar sozinho
                </button>{" "}
                vale como treino, não como corrida.
              </p>
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={() => onReady(!self?.ready)}
            className="w-full border border-ink-700 py-3.5 font-display font-semibold hover:border-paper sm:w-auto sm:px-10"
          >
            {self?.ready ? "Não estou pronto" : "Estou pronto"}
          </button>
        )}

        <p className="text-sm text-dim">
          Um minuto. Quem digitar mais caracteres certos ganha.
          {personalBest && ` Seu recorde: ${formatNumber(personalBest.wpm)} ppm.`}
        </p>
      </div>
    </div>
  );
}

function Countdown({
  room,
  serverNow,
  reduced,
}: {
  room: RoomSnapshot;
  serverNow: () => number;
  reduced: boolean;
}) {
  const [remaining, setRemaining] = useState(3_000);

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
    <div className="flex h-[60vh] flex-col justify-center">
      <p className="text-sm text-dim">todo mundo começa junto</p>
      <p
        key={seconds}
        className={`font-display text-[9rem] leading-none font-semibold tracking-tight tabular-nums ${
          reduced ? "" : "animate-land"
        }`}
      >
        {seconds > 0 ? seconds : "já"}
      </p>
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
      className="max-w-md space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = value.trim();
        if (trimmed.length < 2) return;
        saveNickname(trimmed);
        onConfirm(trimmed);
      }}
    >
      <h1 className="font-display text-3xl font-semibold tracking-tight">
        Como você aparece na sala?
      </h1>
      {error && <p className="text-miss">{error}</p>}
      <input
        className="w-full border-b border-ink-700 bg-transparent pb-2 text-2xl outline-none focus:border-signal"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        maxLength={NICKNAME_MAX_LENGTH}
        placeholder="seu apelido"
        // biome-ignore lint/a11y/noAutofocus: the only field on the screen.
        autoFocus
      />
      <button
        type="submit"
        className="bg-signal px-10 py-3 font-display font-semibold text-ink-900"
      >
        Entrar
      </button>
    </form>
  );
}

function Notice({ children, tone = "dim" }: { children: React.ReactNode; tone?: "dim" | "miss" }) {
  return <p className={tone === "miss" ? "text-miss" : "text-dim"}>{children}</p>;
}

/**
 * The code lives at the root: `typing.jrdan.dev/WF6Q`.
 *
 * The link gets read out loud and typed by hand more often than it gets clicked, and every
 * segment before the code is a segment someone has to say. The alphabet has no O, I, 0 or 1
 * for the same reason.
 */
export const roomRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/$code",
  component: RoomPage,
});

/**
 * Where the code used to live. Links already shared keep working instead of landing on a
 * "página não encontrada" that gives the sharer no idea what went wrong.
 */
export const legacyRoomRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sala/$code",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/$code", params, replace: true });
  },
});
