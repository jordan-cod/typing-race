import {
  buildStream,
  COUNTDOWN_MS,
  checkProgress,
  computeAccuracy,
  computeWpm,
  type ErrorCode,
  MAX_PLAYERS_PER_ROOM,
  type PlayerSnapshot,
  RACE_DURATION_MS,
  type RacePhase,
  type RoomSnapshot,
  rankPlayers,
} from "@typing-race/protocol";

/**
 * How long after the minute is up a progress report is still counted.
 *
 * The last keystrokes of a race and the frame carrying them are separated by the network. A
 * player who typed a character at 59.98s deserves it, and refusing anything that lands after
 * the bell would quietly punish whoever has the worse connection. The report is still measured
 * against a 60-second budget, so the window buys latency, not typing time.
 */
export const LATE_REPORT_GRACE_MS = 1_000;

export type Player = {
  id: string;
  nickname: string;
  ready: boolean;
  connected: boolean;
  /** Set when the player joined after the start; they watch and are left out of the ranking. */
  spectator: boolean;
  correctChars: number;
  errors: number;
};

export type RoomFailure = { ok: false; code: ErrorCode; message: string };
export type RoomSuccess<T = undefined> = { ok: true; value: T };
export type RoomResult<T = undefined> = RoomSuccess<T> | RoomFailure;

const fail = (code: ErrorCode, message: string): RoomFailure => ({ ok: false, code, message });
const succeed = <T>(value: T): RoomSuccess<T> => ({ ok: true, value });

/**
 * A single room and the whole race state machine.
 *
 * Everything here is deterministic: the clock arrives as a `now` argument and there is no I/O,
 * no socket and no timer. The WebSocket layer only translates frames into these calls and
 * broadcasts the resulting snapshot, which is what makes the race rules unit-testable.
 */
export class Room {
  readonly code: string;
  phase: RacePhase = "lobby";
  hostId: string | null = null;
  stream: string | null = null;
  startAt: number | null = null;
  endedAt: number | null = null;
  /** Whether anyone ever joined, so a freshly created code is not swept as abandoned. */
  hasEverJoined = false;

  private readonly players = new Map<string, Player>();
  private readonly random: () => number;

  constructor(code: string, random: () => number = Math.random) {
    this.code = code;
    this.random = random;
  }

  get playerList(): Player[] {
    return [...this.players.values()];
  }

  getPlayer(id: string): Player | undefined {
    return this.players.get(id);
  }

  /** Absolute instant the minute is up. The client renders its clock from this, not a duration. */
  get endsAt(): number | null {
    return this.startAt === null ? null : this.startAt + RACE_DURATION_MS;
  }

  /** Nobody left to broadcast to: the registry drops the room when this is true. */
  get isAbandoned(): boolean {
    return this.playerList.every((player) => !player.connected);
  }

  private get racers(): Player[] {
    return this.playerList.filter((player) => !player.spectator);
  }

  join(id: string, nickname: string): RoomResult<Player> {
    const connected = this.playerList.filter((player) => player.connected);
    if (connected.length >= MAX_PLAYERS_PER_ROOM) {
      return fail("room_full", "Sala cheia");
    }
    const taken = connected.some(
      (player) => player.nickname.toLowerCase() === nickname.toLowerCase(),
    );
    if (taken) return fail("nickname_taken", "Esse apelido ja esta em uso na sala");

    // Voltar com o mesmo apelido e reconectar, nao entrar de novo. Sem isto, quem cai no meio
    // da corrida reaparece como um segundo jogador e deixa a propria pista orfa na tela dos
    // outros, com o progresso que ja tinha feito preso nela.
    const anterior = [...this.players.values()].find(
      (player) => !player.connected && player.nickname.toLowerCase() === nickname.toLowerCase(),
    );
    if (anterior) {
      this.players.delete(anterior.id);
      const voltou: Player = { ...anterior, id, connected: true };
      this.players.set(id, voltou);
      if (this.hostId === anterior.id) this.hostId = id;
      return succeed(voltou);
    }

    // A race already under way is joined as a spectator: dropping someone into a minute the
    // others started 40 seconds ago would only produce a rigged ranking.
    const spectator = this.phase !== "lobby";
    const player: Player = {
      id,
      nickname,
      ready: false,
      connected: true,
      spectator,
      correctChars: 0,
      errors: 0,
    };
    this.players.set(id, player);
    this.hasEverJoined = true;
    if (this.hostId === null && !spectator) this.hostId = id;
    return succeed(player);
  }

  leave(id: string): void {
    const player = this.players.get(id);
    if (!player) return;

    if (this.phase === "lobby" || this.phase === "finished" || player.spectator) {
      this.players.delete(id);
    } else {
      // Mid-race we keep the record so the others keep seeing the lane, and so the player is
      // still in the final ranking with the characters they did type.
      player.connected = false;
      player.ready = false;
    }

    if (this.hostId === id) this.hostId = this.nextHostId();
  }

  private nextHostId(): string | null {
    const candidate =
      this.playerList.find((player) => player.connected && !player.spectator) ??
      this.playerList.find((player) => player.connected);
    return candidate?.id ?? null;
  }

  setReady(id: string, ready: boolean): RoomResult {
    const player = this.players.get(id);
    if (!player) return fail("not_joined", "Voce nao esta na sala");
    if (this.phase !== "lobby") return fail("wrong_phase", "A corrida ja comecou");
    if (player.spectator) return fail("wrong_phase", "Voce esta assistindo");
    player.ready = ready;
    return succeed(undefined);
  }

  start(id: string, now: number, solo: boolean): RoomResult {
    if (this.hostId !== id) return fail("not_host", "So quem criou a sala pode comecar");
    if (this.phase !== "lobby") return fail("wrong_phase", "A corrida ja comecou");

    const racers = this.racers.filter((player) => player.connected);
    if (racers.length === 0) return fail("not_enough_players", "Ninguem na sala");
    if (racers.length === 1 && !solo) {
      return fail("not_enough_players", "Chame mais alguem para correr");
    }

    // Quem cria a sala nao marca "pronto": comecar a corrida e o pronto dele. Todo o resto
    // precisa ter dito que esta, senao a largada acontece por cima de quem ainda estava
    // ajeitando o teclado — e num minuto cronometrado isso decide a corrida.
    const esperando = racers.filter((player) => player.id !== id && !player.ready);
    if (esperando.length > 0) {
      const nomes = esperando.map((player) => player.nickname).join(", ");
      return fail(
        "not_ready",
        esperando.length === 1
          ? `${nomes} ainda nao esta pronto`
          : `Ainda nao estao prontos: ${nomes}`,
      );
    }

    // Built once, here, and handed to everyone: the room races the same words or it is not a
    // race.
    this.stream = buildStream(this.random);
    this.phase = "countdown";
    // An absolute instant, not a duration: every client races against the same server clock,
    // so a slow browser loses nothing more than the render of its own countdown.
    this.startAt = now + COUNTDOWN_MS;
    this.endedAt = null;
    for (const player of this.racers) {
      player.correctChars = 0;
      player.errors = 0;
    }
    return succeed(undefined);
  }

  /**
   * Records progress reported by a client.
   *
   * The numbers are only ever accepted as a *claim*: the elapsed time is the server's, and a
   * report that would need superhuman speed (a paste, most of the time) is dropped without
   * touching the stored progress, so a client cannot climb the ranking by lying.
   */
  applyProgress(id: string, correctChars: number, errors: number, now: number): RoomResult {
    const player = this.players.get(id);
    if (!player) return fail("not_joined", "Voce nao esta na sala");
    if (this.startAt === null || this.stream === null || !this.acceptsProgressAt(now)) {
      return fail("wrong_phase", "A corrida nao esta em andamento");
    }
    if (player.spectator) return fail("wrong_phase", "Voce esta assistindo");

    // Capped at the race duration so a report that arrives after the bell is measured against
    // the minute the player actually had, not against the extra latency.
    const elapsedMs = Math.min(now - this.startAt, RACE_DURATION_MS);
    const check = checkProgress({
      previousChars: player.correctChars,
      nextChars: correctChars,
      previousErrors: player.errors,
      nextErrors: errors,
      streamLength: this.stream.length,
      elapsedMs,
    });
    if (!check.ok) return fail("progress_rejected", rejectionMessage(check.reason));

    player.correctChars = correctChars;
    player.errors = errors;
    return succeed(undefined);
  }

  private acceptsProgressAt(now: number): boolean {
    if (this.phase === "racing") return true;
    if (this.phase !== "finished" || this.endedAt === null) return false;
    return now - this.endedAt <= LATE_REPORT_GRACE_MS;
  }

  /**
   * Advances anything that depends only on the clock. Called from a single server interval,
   * which keeps every time-based transition in one place instead of scattered timeouts.
   *
   * @returns true when the phase changed and the room needs a broadcast.
   */
  tick(now: number): boolean {
    if (this.phase === "countdown" && this.startAt !== null && now >= this.startAt) {
      this.phase = "racing";
      return true;
    }
    if (this.phase === "racing" && this.startAt !== null) {
      const endsAt = this.startAt + RACE_DURATION_MS;
      if (now >= endsAt) {
        this.phase = "finished";
        // The scheduled instant, not `now`: stats are divided by this, and a tick that fires
        // 40ms late must not make everyone's WPM slightly worse.
        this.endedAt = endsAt;
        return true;
      }
      // A room where everyone dropped ends immediately instead of running a minute for nobody.
      if (this.racers.every((player) => !player.connected)) {
        this.phase = "finished";
        this.endedAt = now;
        return true;
      }
    }
    return false;
  }

  playAgain(id: string): RoomResult {
    if (this.hostId !== id) return fail("not_host", "So quem criou a sala pode reiniciar");
    if (this.phase !== "finished") return fail("wrong_phase", "A corrida ainda nao terminou");

    for (const [playerId, player] of this.players) {
      if (!player.connected) {
        this.players.delete(playerId);
        continue;
      }
      player.ready = false;
      // Whoever watched the last race is a full racer in the next one.
      player.spectator = false;
      player.correctChars = 0;
      player.errors = 0;
    }
    this.phase = "lobby";
    this.stream = null;
    this.startAt = null;
    this.endedAt = null;
    if (this.hostId !== null && !this.players.has(this.hostId)) this.hostId = this.nextHostId();
    return succeed(undefined);
  }

  snapshot(now: number): RoomSnapshot {
    const elapsedMs = this.elapsedAt(now);
    // Ranked live, not only at the end: a player needs to see the moment they are passed.
    const ranked =
      this.phase === "racing" || this.phase === "finished"
        ? rankPlayers(
            this.racers.map((player) => ({
              playerId: player.id,
              nickname: player.nickname,
              correctChars: player.correctChars,
              errors: player.errors,
              connected: player.connected,
            })),
            elapsedMs,
          )
        : [];
    const rankById = new Map(ranked.map((entry) => [entry.playerId, entry.rank]));

    const players: PlayerSnapshot[] = this.playerList.map((player) => ({
      id: player.id,
      nickname: player.nickname,
      isHost: player.id === this.hostId,
      ready: player.ready,
      connected: player.connected,
      spectator: player.spectator,
      correctChars: player.correctChars,
      errors: player.errors,
      wpm: computeWpm(player.correctChars, elapsedMs),
      accuracy: computeAccuracy(player.correctChars, player.errors),
      rank: player.spectator ? null : (rankById.get(player.id) ?? null),
    }));

    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      startAt: this.startAt,
      endsAt: this.endsAt,
      endedAt: this.endedAt,
      players,
      serverTime: now,
    };
  }

  private elapsedAt(now: number): number {
    if (this.startAt === null) return 0;
    const until = this.endedAt ?? now;
    return Math.min(Math.max(0, until - this.startAt), RACE_DURATION_MS);
  }
}

function rejectionMessage(reason: string): string {
  switch (reason) {
    case "impossible_speed":
      return "Progresso invalido: rapido demais para ser digitado";
    case "beyond_stream":
      return "Progresso invalido: passou do fim do texto";
    default:
      return "Progresso invalido";
  }
}
