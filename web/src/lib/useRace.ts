import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  asServerMessage,
  type ClientMessage,
  type ErrorCode,
  type RoomSnapshot,
} from "../protocol/index.ts";
import { websocketUrl } from "./api.ts";

export type ConnectionStatus = "connecting" | "open" | "closed";

export type RaceError = { code: ErrorCode; message: string; fatal: boolean };

export type RaceConnection = {
  status: ConnectionStatus;
  /** Try again now, instead of waiting out the backoff. */
  reconnect: () => void;
  playerId: string | null;
  room: RoomSnapshot | null;
  /** The words for the current race. Arrives once per race on its own message. */
  stream: string;
  error: RaceError | null;
  dismissError: () => void;
  send: (message: ClientMessage) => void;
  /** Current time on the server's clock, corrected for the measured offset. */
  serverNow: () => number;
};

const PING_INTERVAL_MS = 4_000;

/**
 * Reconnection backoff. A dropped socket used to be the end of the session: the screen said
 * "conexão perdida" and offered nothing, so a two-second wifi blip cost the race. The first
 * retry is almost immediate because most drops are exactly that blip; the delay grows so a
 * server that is actually down is not hammered.
 */
const RETRY_DELAYS_MS = [400, 1_000, 2_000, 4_000, 8_000];

export function useRace(code: string, nickname: string): RaceConnection {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [stream, setStream] = useState("");
  const [error, setError] = useState<RaceError | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const offsetRef = useRef(0);
  const bestRttRef = useRef(Number.POSITIVE_INFINITY);
  const [attempt, setAttempt] = useState(0);

  const reconnect = useCallback(() => {
    // Bumping the attempt re-runs the effect below, which is what opens a new socket.
    socketRef.current?.close();
    setAttempt((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!nickname) return;
    setStatus("connecting");
    const socket = new WebSocket(websocketUrl());
    socketRef.current = socket;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const ping = () => socket.send(JSON.stringify({ type: "ping", clientTime: Date.now() }));

    socket.onopen = () => {
      setStatus("open");
      socket.send(JSON.stringify({ type: "join", roomCode: code, nickname }));
      ping();
      pingTimer = setInterval(ping, PING_INTERVAL_MS);
    };

    socket.onmessage = (event) => {
      const message = asServerMessage(event.data);
      if (!message) return;
      switch (message.type) {
        case "welcome":
          setPlayerId(message.playerId);
          break;
        case "state":
          setRoom(message.room);
          // Back in the lobby there is nothing to type, and holding the old stream would let
          // a stale race screen render for a frame after a restart.
          if (message.room.phase === "lobby") setStream("");
          break;
        case "race_text":
          setStream(message.stream);
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

    // The server puts a player who left back where they were when they return with the same
    // nickname, so retrying is enough to restore the lane and the characters already typed.
    socket.onclose = () => {
      setStatus("closed");
      if (pingTimer) clearInterval(pingTimer);
      const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)] ?? 8_000;
      retryTimer = setTimeout(() => setAttempt((current) => current + 1), delay);
    };

    return () => {
      if (pingTimer) clearInterval(pingTimer);
      if (retryTimer) clearTimeout(retryTimer);
      socket.onclose = null;
      socket.close();
      socketRef.current = null;
    };
  }, [code, nickname, attempt]);

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
    () => ({ status, reconnect, playerId, room, stream, error, dismissError, send, serverNow }),
    [status, reconnect, playerId, room, stream, error, dismissError, send, serverNow],
  );
}
