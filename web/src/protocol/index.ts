/**
 * The wire contract.
 *
 * Everything in `generated.ts` comes from `internal/protocol` in Go and must not be edited;
 * what lives here is the little the browser needs on top of the types.
 */

export * from "./generated.ts";
export { computeAccuracy, computeWpm } from "./stats.ts";

import { RoomCodeAlphabet, RoomCodeLength, type ServerMessage } from "./generated.ts";

const ROOM_CODE = new RegExp(`^[${RoomCodeAlphabet}]{${RoomCodeLength}}$`);

/**
 * Normalises a code typed into the form, or returns null.
 *
 * The server checks the same thing and its answer is the one that counts; this exists so the
 * player is told about a typo before a round trip, not after.
 */
export function normalizeRoomCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  return ROOM_CODE.test(code) ? code : null;
}

const SERVER_MESSAGE_TYPES = new Set<ServerMessage["type"]>([
  "welcome",
  "state",
  "race_text",
  "pong",
  "error",
]);

/**
 * Narrows a frame that just arrived on the socket.
 *
 * It checks the discriminant and nothing else. The old client re-validated every field with a
 * schema, which was really the server checking itself: the shapes now come from the same Go
 * definition the server marshals from, so the only thing worth guarding against is a frame
 * from a version that does not know this one — and that is exactly what the tag catches.
 */
export function asServerMessage(raw: unknown): ServerMessage | null {
  if (typeof raw !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const type = (parsed as { type?: unknown }).type;
  if (typeof type !== "string" || !SERVER_MESSAGE_TYPES.has(type as ServerMessage["type"])) {
    return null;
  }
  return parsed as ServerMessage;
}
