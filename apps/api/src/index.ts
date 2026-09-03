import { cors } from "@elysiajs/cors";
import {
  type ServerMessage,
  parseClientMessage,
  roomCodeSchema,
  serverMessageSchema,
} from "@typing-race/protocol";
import { Elysia } from "elysia";
import { RoomRegistry } from "./race/registry.ts";
import type { Room } from "./race/room.ts";

const PORT = Number(process.env.PORT ?? 3001);
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";
/** Fast enough that a countdown and other lanes look live, cheap enough to run per room. */
const TICK_MS = 120;

const registry = new RoomRegistry();

type Connection = {
  send: (message: ServerMessage) => void;
  close: () => void;
  roomCode: string | null;
  playerId: string | null;
};

const connections = new Map<string, Connection>();
/** socket ids per room code, so a broadcast does not scan every open connection. */
const roomConnections = new Map<string, Set<string>>();

function send(connection: Connection, message: ServerMessage): void {
  // Outgoing messages are validated too: the contract is only worth something if both
  // directions are checked, and a shape drift shows up here instead of in the browser.
  const parsed = serverMessageSchema.safeParse(message);
  if (!parsed.success) {
    console.error("invalid outgoing message", parsed.error.issues);
    return;
  }
  connection.send(parsed.data);
}

function broadcastRoom(room: Room, now = Date.now()): void {
  const ids = roomConnections.get(room.code);
  if (!ids) return;
  const message: ServerMessage = { type: "state", room: room.snapshot(now) };
  for (const id of ids) {
    const connection = connections.get(id);
    if (connection) send(connection, message);
  }
}

function attach(socketId: string, code: string): void {
  const set = roomConnections.get(code) ?? new Set<string>();
  set.add(socketId);
  roomConnections.set(code, set);
}

function detach(socketId: string, code: string): void {
  const set = roomConnections.get(code);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) roomConnections.delete(code);
}

function handleLeave(socketId: string): void {
  const connection = connections.get(socketId);
  connections.delete(socketId);
  if (!connection?.roomCode) return;

  const room = registry.get(connection.roomCode);
  detach(socketId, connection.roomCode);
  if (!room) return;
  if (connection.playerId) room.leave(connection.playerId);

  if (room.isAbandoned || room.playerList.length === 0) {
    registry.delete(room.code);
    return;
  }
  broadcastRoom(room);
}

const app = new Elysia()
  .use(cors({ origin: [WEB_ORIGIN, /localhost:\d+$/] }))
  .get("/health", () => ({ ok: true, rooms: registry.size }))
  .post("/rooms", () => {
    const room = registry.create(Date.now());
    return { code: room.code };
  })
  .get("/rooms/:code", ({ params, status }) => {
    const parsed = roomCodeSchema.safeParse(params.code);
    if (!parsed.success) return status(400, { error: "invalid_code" });
    const room = registry.get(parsed.data);
    if (!room) return status(404, { error: "room_not_found" });
    return {
      code: room.code,
      phase: room.phase,
      players: room.playerList.filter((player) => player.connected).length,
    };
  })
  .ws("/ws", {
    open(ws) {
      connections.set(ws.id, {
        send: (message) => ws.send(message),
        close: () => ws.close(),
        roomCode: null,
        playerId: null,
      });
    },
    message(ws, raw) {
      const connection = connections.get(ws.id);
      if (!connection) return;

      const parsed = parseClientMessage(raw);
      if (!parsed.success) {
        send(connection, {
          type: "error",
          code: "invalid_message",
          message: "Mensagem invalida",
          fatal: false,
        });
        return;
      }
      const message = parsed.data;
      const now = Date.now();

      if (message.type === "ping") {
        send(connection, { type: "pong", clientTime: message.clientTime, serverTime: now });
        return;
      }

      if (message.type === "join") {
        if (connection.playerId) return;
        const room = registry.get(message.roomCode);
        if (!room) {
          send(connection, {
            type: "error",
            code: "room_not_found",
            message: "Sala nao encontrada",
            fatal: true,
          });
          connection.close();
          return;
        }
        const result = room.join(ws.id, message.nickname);
        if (!result.ok) {
          send(connection, { type: "error", code: result.code, message: result.message, fatal: true });
          connection.close();
          return;
        }
        connection.roomCode = room.code;
        connection.playerId = result.value.id;
        attach(ws.id, room.code);
        send(connection, {
          type: "welcome",
          playerId: result.value.id,
          spectator: result.value.spectator,
          serverTime: now,
        });
        broadcastRoom(room, now);
        return;
      }

      const { roomCode, playerId } = connection;
      if (!roomCode || !playerId) {
        send(connection, {
          type: "error",
          code: "not_joined",
          message: "Entre em uma sala primeiro",
          fatal: false,
        });
        return;
      }
      const room = registry.get(roomCode);
      if (!room) {
        send(connection, {
          type: "error",
          code: "room_not_found",
          message: "A sala nao existe mais",
          fatal: true,
        });
        connection.close();
        return;
      }

      const result = (() => {
        switch (message.type) {
          case "set_ready":
            return room.setReady(playerId, message.ready);
          case "start_race":
            return room.start(playerId, now, message.solo);
          case "progress":
            return room.applyProgress(playerId, message.correctChars, message.errors, now);
          case "play_again":
            return room.playAgain(playerId);
        }
      })();

      if (!result.ok) {
        send(connection, {
          type: "error",
          code: result.code,
          message: result.message,
          fatal: false,
        });
        // A rejected progress report still gets a snapshot back so the cheating client is
        // snapped back to the progress the server actually believes.
        if (result.code === "progress_rejected") {
          send(connection, { type: "state", room: room.snapshot(now) });
        }
        return;
      }
      broadcastRoom(room, now);
    },
    close(ws) {
      handleLeave(ws.id);
    },
  })
  .listen(PORT);

setInterval(() => {
  const now = Date.now();
  for (const room of registry.tick(now)) broadcastRoom(room, now);
  // While a race runs, everyone needs a steady stream of the other lanes even when no
  // message arrived from them.
  for (const code of roomConnections.keys()) {
    const room = registry.get(code);
    if (room && (room.phase === "racing" || room.phase === "countdown")) broadcastRoom(room, now);
  }
  for (const code of registry.sweep(now)) roomConnections.delete(code);
}, TICK_MS);

console.log(`API on http://localhost:${app.server?.port}`);

export type App = typeof app;
