import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "@typing-race/protocol";
import { Room } from "./room.ts";

/** A room nobody ever joined is dropped after this long, so abandoned codes do not pile up. */
export const EMPTY_ROOM_TTL_MS = 2 * 60_000;

export function generateRoomCode(random: () => number = Math.random): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    const index = Math.floor(random() * ROOM_CODE_ALPHABET.length);
    code += ROOM_CODE_ALPHABET[Math.min(index, ROOM_CODE_ALPHABET.length - 1)];
  }
  return code;
}

/**
 * In-memory room store. Rooms are ephemeral by design: there is no database, and a room stops
 * existing as soon as the last player disconnects.
 */
export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();
  private readonly createdAt = new Map<string, number>();
  private readonly random: () => number;

  constructor(random: () => number = Math.random) {
    this.random = random;
  }

  get size(): number {
    return this.rooms.size;
  }

  create(now: number): Room {
    let code = generateRoomCode(this.random);
    while (this.rooms.has(code)) code = generateRoomCode(this.random);
    const room = new Room(code, this.random);
    this.rooms.set(code, room);
    this.createdAt.set(code, now);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  delete(code: string): void {
    this.rooms.delete(code);
    this.createdAt.delete(code);
  }

  /** Advances every room's clock and returns the ones whose state changed. */
  tick(now: number): Room[] {
    const changed: Room[] = [];
    for (const room of this.rooms.values()) {
      if (room.tick(now)) changed.push(room);
    }
    return changed;
  }

  /** Drops rooms that emptied out and codes that were created but never used. */
  sweep(now: number): string[] {
    const removed: string[] = [];
    for (const [code, room] of this.rooms) {
      const created = this.createdAt.get(code) ?? now;
      const expiredUnused = !room.hasEverJoined && now - created > EMPTY_ROOM_TTL_MS;
      if (expiredUnused || (room.hasEverJoined && room.isAbandoned)) {
        this.delete(code);
        removed.push(code);
      }
    }
    return removed;
  }
}
