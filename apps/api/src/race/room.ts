import {
  COUNTDOWN_MS,
  checkProgress,
  computeAccuracy,
  computeWpm,
  type ErrorCode,
  MAX_PLAYERS_PER_ROOM,
  type Passage,
  type PlayerSnapshot,
  pickPassage,
  type RacePhase,
  type RoomSnapshot,
  rankPlayers,
} from "@typing-race/protocol";

/** A race is force-ended after this long so a room can never hang on an idle racer. */
export const RACE_TIMEOUT_MS = 5 * 60_000;

/**
 * Once the first player crosses the line the others get this long to finish before the race
 * is closed. Without it, a single slow player would keep everyone else on the race screen.
 */
export const FINISH_GRACE_MS = 30_000;

export type Player = {
  id: string;
  nickname: string;
  ready: boolean;
  connected: boolean;
  /** Set when the player joined after the start; they watch and are left out of the ranking. */
  spectator: boolean;
  correctChars: number;
  errors: number;
  finishTimeMs: number | null;
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
  passage: Passage | null = null;
  startAt: number | null = null;
  endedAt: number | null = null;
  firstFinishAt: number | null = null;
  /** Whether anyone ever joined, so a freshly created code is not swept as abandoned. */
  hasEverJoined = false;

  private readonly players = new Map<string, Player>();
  private readonly usedPassageIds: string[] = [];
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

    // A race already under way is joined as a spectator: dropping someone into a passage the
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
      finishTimeMs: null,
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
      // Mid-race we keep the record so the others keep seeing the empty lane and so the
      // player still appears in the final ranking with the progress they had.
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

    this.passage = pickPassage(this.usedPassageIds, this.random);
    this.usedPassageIds.push(this.passage.id);
    this.phase = "countdown";
    // An absolute instant, not a duration: every client races against the same server clock,
    // so a slow browser loses nothing more than the render of its own countdown.
    this.startAt = now + COUNTDOWN_MS;
    this.endedAt = null;
    this.firstFinishAt = null;
    for (const player of this.racers) {
      player.correctChars = 0;
      player.errors = 0;
      player.finishTimeMs = null;
    }
    return succeed(undefined);
  }

  /**
   * Records progress reported by a client.
   *
   * The numbers are only ever accepted as a *claim*: the elapsed time is the server's, and a
   * report that would need superhuman speed (a paste, most of the time) is dropped without
   * touching the stored progress, so the client cannot climb the ranking by lying.
   */
  applyProgress(id: string, correctChars: number, errors: number, now: number): RoomResult {
    const player = this.players.get(id);
    if (!player) return fail("not_joined", "Voce nao esta na sala");
    if (this.phase !== "racing" || this.startAt === null || this.passage === null) {
      return fail("wrong_phase", "A corrida nao esta em andamento");
    }
    if (player.spectator) return fail("wrong_phase", "Voce esta assistindo");
    if (player.finishTimeMs !== null) return fail("wrong_phase", "Voce ja terminou");

    const elapsedMs = now - this.startAt;
    const check = checkProgress({
      previousChars: player.correctChars,
      nextChars: correctChars,
      previousErrors: player.errors,
      nextErrors: errors,
      passageLength: this.passage.text.length,
      elapsedMs,
    });
    if (!check.ok) {
      return fail("progress_rejected", rejectionMessage(check.reason));
    }

    player.correctChars = correctChars;
    player.errors = errors;
    if (correctChars === this.passage.text.length) {
      player.finishTimeMs = elapsedMs;
      if (this.firstFinishAt === null) this.firstFinishAt = now;
    }
    return succeed(undefined);
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
    if (this.phase === "racing" && this.shouldEnd(now)) {
      this.phase = "finished";
      this.endedAt = now;
      return true;
    }
    return false;
  }

  private shouldEnd(now: number): boolean {
    if (this.startAt === null) return false;
    if (now - this.startAt >= RACE_TIMEOUT_MS) return true;
    if (this.firstFinishAt !== null && now - this.firstFinishAt >= FINISH_GRACE_MS) return true;

    const contenders = this.racers.filter((player) => player.connected);
    // A room where everyone dropped ends immediately instead of idling for five minutes.
    if (contenders.length === 0) return true;
    return contenders.every((player) => player.finishTimeMs !== null);
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
      player.finishTimeMs = null;
    }
    this.phase = "lobby";
    this.passage = null;
    this.startAt = null;
    this.endedAt = null;
    this.firstFinishAt = null;
    if (this.hostId !== null && !this.players.has(this.hostId)) this.hostId = this.nextHostId();
    return succeed(undefined);
  }

  snapshot(now: number): RoomSnapshot {
    const running = this.startAt !== null && now >= this.startAt;
    const referenceEnd = this.endedAt ?? now;
    const elapsedMs = this.startAt === null ? 0 : Math.max(0, referenceEnd - this.startAt);
    const ranked =
      this.phase === "finished"
        ? rankPlayers(
            this.racers.map((player) => ({
              playerId: player.id,
              nickname: player.nickname,
              correctChars: player.correctChars,
              errors: player.errors,
              finishTimeMs: player.finishTimeMs,
              connected: player.connected,
            })),
            elapsedMs,
          )
        : [];
    const rankById = new Map(ranked.map((entry) => [entry.playerId, entry.rank]));
    const passageLength = this.passage?.text.length ?? 0;

    const players: PlayerSnapshot[] = this.playerList.map((player) => {
      const duration = player.finishTimeMs ?? (running ? elapsedMs : 0);
      return {
        id: player.id,
        nickname: player.nickname,
        isHost: player.id === this.hostId,
        ready: player.ready,
        connected: player.connected,
        spectator: player.spectator,
        correctChars: player.correctChars,
        errors: player.errors,
        progress: passageLength === 0 ? 0 : player.correctChars / passageLength,
        wpm: computeWpm(player.correctChars, duration),
        accuracy: computeAccuracy(player.correctChars, player.errors),
        finishTimeMs: player.finishTimeMs,
        rank: rankById.get(player.id) ?? null,
      };
    });

    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      passage: this.passage?.text ?? null,
      startAt: this.startAt,
      endedAt: this.endedAt,
      players,
      serverTime: now,
    };
  }
}

function rejectionMessage(reason: string): string {
  switch (reason) {
    case "impossible_speed":
      return "Progresso invalido: rapido demais para ser digitado";
    case "beyond_passage":
      return "Progresso invalido: passou do fim do texto";
    default:
      return "Progresso invalido";
  }
}
