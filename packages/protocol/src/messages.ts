import { z } from "zod";

export const ROOM_CODE_LENGTH = 4;
/** Ambiguous glyphs (I/O/0/1) are left out so a code read out loud is not misheard. */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const MAX_PLAYERS_PER_ROOM = 8;
export const NICKNAME_MIN_LENGTH = 2;
export const NICKNAME_MAX_LENGTH = 16;
/** How long the countdown lasts. The server publishes an absolute instant, not a duration. */
export const COUNTDOWN_MS = 3_000;

export const roomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`), "Codigo invalido");

export const nicknameSchema = z
  .string()
  .trim()
  .min(NICKNAME_MIN_LENGTH, "Apelido muito curto")
  .max(NICKNAME_MAX_LENGTH, "Apelido muito longo");

export const racePhaseSchema = z.enum(["lobby", "countdown", "racing", "finished"]);
export type RacePhase = z.infer<typeof racePhaseSchema>;

// ---------------------------------------------------------------------------
// client -> server
// ---------------------------------------------------------------------------

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("join"),
    roomCode: roomCodeSchema,
    nickname: nicknameSchema,
  }),
  z.object({ type: z.literal("set_ready"), ready: z.boolean() }),
  z.object({
    type: z.literal("start_race"),
    /**
     * Racing alone is allowed, but only when the client says so explicitly. Without this
     * flag a one-person room is refused, so nobody starts a "race" by accident while the
     * second player is still typing their nickname.
     */
    solo: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("progress"),
    correctChars: z.int().min(0),
    errors: z.int().min(0),
  }),
  z.object({ type: z.literal("play_again") }),
  z.object({ type: z.literal("ping"), clientTime: z.number() }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

// ---------------------------------------------------------------------------
// server -> client
// ---------------------------------------------------------------------------

export const playerSnapshotSchema = z.object({
  id: z.string(),
  nickname: z.string(),
  isHost: z.boolean(),
  ready: z.boolean(),
  connected: z.boolean(),
  /** Joined after the start, so watches this race without a place in the ranking. */
  spectator: z.boolean(),
  correctChars: z.number(),
  errors: z.number(),
  wpm: z.number(),
  accuracy: z.number(),
  /** Live position during the race, not only at the end: being passed is the whole tension. */
  rank: z.number().nullable(),
});
export type PlayerSnapshot = z.infer<typeof playerSnapshotSchema>;

export const roomSnapshotSchema = z.object({
  code: roomCodeSchema,
  phase: racePhaseSchema,
  hostId: z.string().nullable(),
  /** Absolute server instant the race starts, in epoch ms. Null outside a race. */
  startAt: z.number().nullable(),
  /** Absolute server instant the minute is up. Clients render the clock from this. */
  endsAt: z.number().nullable(),
  endedAt: z.number().nullable(),
  players: z.array(playerSnapshotSchema),
  /** Server clock at the moment this snapshot was built, used by clients to fix their offset. */
  serverTime: z.number(),
});
export type RoomSnapshot = z.infer<typeof roomSnapshotSchema>;

export const errorCodeSchema = z.enum([
  "invalid_message",
  "room_not_found",
  "room_full",
  "nickname_taken",
  "not_joined",
  "not_host",
  "not_enough_players",
  "not_ready",
  "wrong_phase",
  "progress_rejected",
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const serverMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("welcome"),
    playerId: z.string(),
    spectator: z.boolean(),
    serverTime: z.number(),
  }),
  z.object({ type: z.literal("state"), room: roomSnapshotSchema }),
  /**
   * The text for one race: a few kilobytes, identical for everyone in the room, and constant
   * for the whole minute. It travels on its own message because `state` is broadcast several
   * times a second and there is no reason to resend the words with every frame.
   */
  z.object({ type: z.literal("race_text"), stream: z.string() }),
  z.object({ type: z.literal("pong"), clientTime: z.number(), serverTime: z.number() }),
  z.object({
    type: z.literal("error"),
    code: errorCodeSchema,
    message: z.string(),
    /** Fatal errors mean the socket is about to be closed by the server. */
    fatal: z.boolean(),
  }),
]);

export type ServerMessage = z.infer<typeof serverMessageSchema>;

export function parseClientMessage(raw: unknown): z.ZodSafeParseResult<ClientMessage> {
  return clientMessageSchema.safeParse(raw);
}

export function parseServerMessage(raw: unknown): z.ZodSafeParseResult<ServerMessage> {
  return serverMessageSchema.safeParse(raw);
}
