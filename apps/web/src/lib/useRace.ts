import {
  type ClientMessage,
  type ErrorCode,
  parseServerMessage,
  type RoomSnapshot,
} from "@typing-race/protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { websocketUrl } from "./api.ts";

export type ConnectionStatus = "connecting" | "open" | "closed";

export type RaceError = { code: ErrorCode; message: string; fatal: boolean };

export type RaceConnection = {
  status: ConnectionStatus;
  playerId: string | null;
  room: RoomSnapshot | null;
  error: RaceError | null;
  dismissError: () => void;
  send: (message: ClientMessage) => void;
  /** Current time on the server's clock, corrected for the measured offset. */
  serverNow: () => number;
};

const PING_INTERVAL_MS = 4_000;

export function useRace(code: string, nickname: string): RaceConnection {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState<RaceError | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const offsetRef = useRef(0);
  const bestRttRef = useRef(Number.POSITIVE_INFINITY);

  useEffect(() => {
    if (!nickname) return;
    const socket = new WebSocket(websocketUrl());
    socketRef.current = socket;
    let pingTimer: ReturnType<typeof setInterval> | undefined;

    const ping = () => socket.send(JSON.stringify({ type: "ping", clientTime: Date.now() }));

    socket.onopen = () => {
      setStatus("open");
      socket.send(JSON.stringify({ type: "join", roomCode: code, nickname }));
      ping();
      pingTimer = setInterval(ping, PING_INTERVAL_MS);
    };

    socket.onmessage = (event) => {
      const parsed = parseServerMessage(safeJson(event.data));
      if (!parsed.success) return;
      const message = parsed.data;
      switch (message.type) {
        case "welcome":
          setPlayerId(message.playerId);
          break;
        case "state":
          setRoom(message.room);
          break;
        case "pong": {
          // Keep the sample from the fastest round trip: it is the one where the assumption
          // that the delay is symmetric is least wrong, which matters because the countdown
          // is an absolute server instant.
          const rtt = Date.now() - message.clientTime;
          if (rtt <= bestRttRef.current) {
            bestRttRef.current = rtt;
            offsetRef.current = message.serverTime + rtt / 2 - Date.now();
          }
          break;
        }
        case "error":
          setError({ code: message.code, message: message.message, fatal: message.fatal });
          break;
      }
    };

    socket.onclose = () => {
      setStatus("closed");
      if (pingTimer) clearInterval(pingTimer);
    };

    return () => {
      if (pingTimer) clearInterval(pingTimer);
      socket.onclose = null;
      socket.close();
      socketRef.current = null;
    };
  }, [code, nickname]);

  // Non-fatal errors are transient notices, not state: they clear themselves so the screen
  // does not keep an old complaint on it forever.
  useEffect(() => {
    if (!error || error.fatal) return;
    const timer = setTimeout(() => setError(null), 4_000);
    return () => clearTimeout(timer);
  }, [error]);

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }, []);

  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);
  const dismissError = useCallback(() => setError(null), []);

  return useMemo(
    () => ({ status, playerId, room, error, dismissError, send, serverNow }),
    [status, playerId, room, error, dismissError, send, serverNow],
  );
}

function safeJson(data: unknown): unknown {
  if (typeof data !== "string") return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}
