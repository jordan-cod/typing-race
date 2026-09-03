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

  const link = `${typeof window === "undefined" ? "" : window.location.host}/${room.code}`;

  return (
    <div className="space-y-10">
      {/* A placa de pit: no automobilismo é a placa erguida sobre o muro, com caracteres
          enormes porque é lida de longe e a 200 por hora. O código da sala é a mesma coisa —
          alguém grita ele do outro lado da mesa ou dita no telefone. Então ele é o objeto
          maior da tela, e o resto fica quieto em volta. */}
      <div className="bg-ink-850 px-6 py-7 text-center sm:px-10">
        <div className="stream text-6xl leading-none font-medium tracking-[0.22em] text-signal sm:text-8xl">
          {/* O último caractere carrega o tracking e desloca o centro óptico. */}
          <span className="-mr-[0.22em]">{room.code}</span>
        </div>

        {/* O endereço inteiro, à vista: é isso que a pessoa digita do outro lado, e escondê-lo
            atrás de um botão obriga quem está com o telefone na mão a confiar na área de
            transferência. */}
        <button
          type="button"
          onClick={copyLink}
          className="stream mt-4 text-sm text-dim underline decoration-ink-700 underline-offset-[6px] transition-colors hover:text-paper hover:decoration-signal"
        >
          {copied ? "link copiado" : link}
        </button>
      </div>

      {/* O grid de largada. A numeração é informação de verdade aqui: é a ordem em que as
          pistas aparecem na corrida, não enfeite. */}
      <ol className="space-y-px">
        {room.players.map((player, index) => (
          <li key={player.id} className="flex items-baseline gap-5 bg-ink-850/40 px-5 py-4">
            <span className="stream tnum w-5 shrink-0 text-sm text-dim">{index + 1}</span>
            <span
              className={`min-w-0 flex-1 truncate text-lg ${player.id === selfId ? "text-paper" : "text-dim"}`}
            >
              {player.nickname}
              {player.id === selfId && <span className="ml-2 text-sm text-dim">você</span>}
            </span>
            <span className="shrink-0 text-sm">
              {player.isHost ? (
                <span className="text-dim">criou a sala</span>
              ) : (
                <span className={player.ready ? "text-gain" : "text-dim"}>
                  {player.ready ? "pronto" : "aguardando"}
                </span>
              )}
            </span>
          </li>
        ))}

        {/* A vaga vazia diz que a sala está esperando alguém, coisa que uma lista de um nome
            só não diz. */}
        {alone && (
          <li className="flex items-baseline gap-4 border border-dashed border-ink-800 px-5 py-3.5">
            <span className="stream tnum w-5 shrink-0 text-sm text-ink-700">2</span>
            <span className="flex-1 text-lg text-ink-700">esperando alguém entrar</span>
          </li>
        )}
      </ol>

      <div className="space-y-4">
        {self?.isHost ? (
          <>
            <button
              type="button"
              onClick={() => onStart(false)}
              disabled={!podeComecar}
              // Desabilitado ele vira contorno, não uma laje cinza: um botão que não faz nada
              // não pode ser a coisa mais pesada da tela.
              className="w-full py-4 text-lg font-semibold transition-colors enabled:bg-signal enabled:text-ink-900 enabled:hover:bg-paper disabled:border disabled:border-ink-800 disabled:text-ink-700"
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
                Sozinho dá para{" "}
                <button
                  type="button"
                  onClick={() => onStart(true)}
                  className="text-paper underline underline-offset-4 hover:text-signal"
                >
                  treinar
                </button>
                , mas treino não vale como corrida.
              </p>
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={() => onReady(!self?.ready)}
            className={`w-full py-4 text-lg font-semibold transition-colors ${
              self?.ready
                ? "bg-gain text-ink-900 hover:bg-paper"
                : "border border-ink-700 text-paper hover:border-paper"
            }`}
          >
            {self?.ready ? "Estou pronto" : "Marcar que estou pronto"}
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
