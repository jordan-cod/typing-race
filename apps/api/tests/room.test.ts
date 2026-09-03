import { describe, expect, test } from "bun:test";
import { COUNTDOWN_MS, MAX_PLAYERS_PER_ROOM, PASSAGES } from "@typing-race/protocol";
import { generateRoomCode, RoomRegistry } from "../src/race/registry.ts";
import { FINISH_GRACE_MS, RACE_TIMEOUT_MS, Room } from "../src/race/room.ts";

const T0 = 1_700_000_000_000;
/** Deterministic passage pick, so tests know exactly how long the text is. */
const firstPassage = PASSAGES[0];
if (!firstPassage) throw new Error("no passages");
const PASSAGE_LENGTH = firstPassage.text.length;

function roomWithTwo(): Room {
  const room = new Room("ABCD", () => 0);
  room.join("ana", "Ana");
  room.join("bia", "Bia");
  return room;
}

function startedRoom(): Room {
  const room = roomWithTwo();
  room.start("ana", T0, false);
  room.tick(T0 + COUNTDOWN_MS);
  return room;
}

describe("lobby", () => {
  test("the first player is the host", () => {
    const room = roomWithTwo();
    expect(room.hostId).toBe("ana");
  });

  test("only the host can start", () => {
    const room = roomWithTwo();
    const result = room.start("bia", T0, false);
    expect(result).toMatchObject({ ok: false, code: "not_host" });
    expect(room.phase).toBe("lobby");
  });

  test("a lone player cannot start a race by accident", () => {
    const room = new Room("ABCD", () => 0);
    room.join("ana", "Ana");
    expect(room.start("ana", T0, false)).toMatchObject({
      ok: false,
      code: "not_enough_players",
    });
    expect(room.phase).toBe("lobby");
  });

  test("solo practice works when it is asked for explicitly", () => {
    const room = new Room("ABCD", () => 0);
    room.join("ana", "Ana");
    expect(room.start("ana", T0, true).ok).toBe(true);
    expect(room.phase).toBe("countdown");
  });

  test("refuses a duplicate nickname and a full room", () => {
    const room = roomWithTwo();
    expect(room.join("x", "ANA")).toMatchObject({ ok: false, code: "nickname_taken" });
    for (let i = room.playerList.length; i < MAX_PLAYERS_PER_ROOM; i += 1) {
      expect(room.join(`p${i}`, `Player${i}`).ok).toBe(true);
    }
    expect(room.join("extra", "Extra")).toMatchObject({ ok: false, code: "room_full" });
  });

  test("host passes to another player when the host leaves", () => {
    const room = roomWithTwo();
    room.leave("ana");
    expect(room.hostId).toBe("bia");
    expect(room.playerList).toHaveLength(1);
  });
});

describe("countdown", () => {
  test("the start instant comes from the server clock", () => {
    const room = roomWithTwo();
    room.start("ana", T0, false);
    expect(room.startAt).toBe(T0 + COUNTDOWN_MS);
    expect(room.phase).toBe("countdown");
  });

  test("racing begins only once the instant is reached", () => {
    const room = roomWithTwo();
    room.start("ana", T0, false);
    expect(room.tick(T0 + COUNTDOWN_MS - 1)).toBe(false);
    expect(room.phase).toBe("countdown");
    expect(room.tick(T0 + COUNTDOWN_MS)).toBe(true);
    expect(room.phase).toBe("racing");
  });

  test("progress sent during the countdown is refused", () => {
    const room = roomWithTwo();
    room.start("ana", T0, false);
    expect(room.applyProgress("ana", 5, 0, T0 + 100)).toMatchObject({
      ok: false,
      code: "wrong_phase",
    });
  });
});

describe("progress", () => {
  test("accepted progress moves the player and updates live stats", () => {
    const room = startedRoom();
    const at = T0 + COUNTDOWN_MS + 10_000;
    expect(room.applyProgress("ana", 100, 4, at).ok).toBe(true);
    const snapshot = room.snapshot(at);
    const ana = snapshot.players.find((player) => player.id === "ana");
    expect(ana?.correctChars).toBe(100);
    expect(ana?.wpm).toBe(120);
    expect(ana?.accuracy).toBeCloseTo(96.2, 1);
    expect(ana?.progress).toBeCloseTo(100 / PASSAGE_LENGTH, 5);
  });

  test("a pasted passage is rejected and leaves the stored progress alone", () => {
    const room = startedRoom();
    const at = T0 + COUNTDOWN_MS + 300;
    const result = room.applyProgress("ana", PASSAGE_LENGTH, 0, at);
    expect(result).toMatchObject({ ok: false, code: "progress_rejected" });
    expect(room.getPlayer("ana")?.correctChars).toBe(0);
    expect(room.getPlayer("ana")?.finishTimeMs).toBeNull();
    expect(room.phase).toBe("racing");
  });

  test("a cheater cannot top the ranking of an honest player", () => {
    const room = startedRoom();
    const honestFinish = T0 + COUNTDOWN_MS + 40_000;
    // The cheat lands first in wall-clock terms but is not physically typeable.
    expect(room.applyProgress("bia", PASSAGE_LENGTH, 0, T0 + COUNTDOWN_MS + 500).ok).toBe(false);
    expect(room.applyProgress("ana", PASSAGE_LENGTH, 2, honestFinish).ok).toBe(true);
    room.tick(honestFinish + FINISH_GRACE_MS);

    const ranking = room.snapshot(honestFinish + FINISH_GRACE_MS).players;
    expect(ranking.find((player) => player.id === "ana")?.rank).toBe(1);
    expect(ranking.find((player) => player.id === "bia")?.rank).toBe(2);
  });

  test("finishing is recorded against the server clock, not the client's", () => {
    const room = startedRoom();
    const at = T0 + COUNTDOWN_MS + 45_000;
    room.applyProgress("ana", PASSAGE_LENGTH, 0, at);
    expect(room.getPlayer("ana")?.finishTimeMs).toBe(45_000);
  });
});

describe("finishing", () => {
  test("the race ends once every connected racer is done", () => {
    const room = startedRoom();
    const first = T0 + COUNTDOWN_MS + 20_000;
    room.applyProgress("ana", PASSAGE_LENGTH, 0, first);
    expect(room.tick(first + 1)).toBe(false);
    room.applyProgress("bia", PASSAGE_LENGTH, 0, first + 5_000);
    expect(room.tick(first + 5_001)).toBe(true);
    expect(room.phase).toBe("finished");
  });

  test("a player who drops mid-race does not freeze the others", () => {
    const room = startedRoom();
    const at = T0 + COUNTDOWN_MS + 10_000;
    room.applyProgress("bia", 50, 0, at);
    room.leave("bia");
    expect(room.getPlayer("bia")?.connected).toBe(false);

    room.applyProgress("ana", PASSAGE_LENGTH, 0, at + 5_000);
    expect(room.tick(at + 5_001)).toBe(true);
    expect(room.phase).toBe("finished");

    const players = room.snapshot(at + 5_001).players;
    const bia = players.find((player) => player.id === "bia");
    // Still ranked, with the progress they had when the connection dropped.
    expect(bia?.rank).toBe(2);
    expect(bia?.correctChars).toBe(50);
    expect(bia?.connected).toBe(false);
  });

  test("the race ends when everybody drops", () => {
    const room = startedRoom();
    room.leave("ana");
    room.leave("bia");
    expect(room.tick(T0 + COUNTDOWN_MS + 1_000)).toBe(true);
    expect(room.phase).toBe("finished");
    expect(room.isAbandoned).toBe(true);
  });

  test("stragglers get a grace window, then the race closes", () => {
    const room = startedRoom();
    const finish = T0 + COUNTDOWN_MS + 10_000;
    room.applyProgress("ana", PASSAGE_LENGTH, 0, finish);
    expect(room.tick(finish + FINISH_GRACE_MS - 1)).toBe(false);
    expect(room.tick(finish + FINISH_GRACE_MS)).toBe(true);
    expect(room.phase).toBe("finished");
  });

  test("a race nobody finishes times out", () => {
    const room = startedRoom();
    expect(room.tick(T0 + COUNTDOWN_MS + RACE_TIMEOUT_MS)).toBe(true);
    expect(room.phase).toBe("finished");
  });
});

describe("latecomers", () => {
  test("someone arriving after the start watches instead of racing", () => {
    const room = startedRoom();
    const joined = room.join("caio", "Caio");
    expect(joined).toMatchObject({ ok: true });
    expect(room.getPlayer("caio")?.spectator).toBe(true);
    expect(room.applyProgress("caio", 10, 0, T0 + COUNTDOWN_MS + 5_000)).toMatchObject({
      ok: false,
      code: "wrong_phase",
    });
    expect(
      room.snapshot(T0 + COUNTDOWN_MS + 5_000).players.find((p) => p.id === "caio")?.rank,
    ).toBeNull();
  });

  test("a spectator becomes a racer in the next race", () => {
    const room = startedRoom();
    room.join("caio", "Caio");
    const finish = T0 + COUNTDOWN_MS + 10_000;
    room.applyProgress("ana", PASSAGE_LENGTH, 0, finish);
    room.applyProgress("bia", PASSAGE_LENGTH, 0, finish);
    room.tick(finish + 1);

    expect(room.playAgain("ana").ok).toBe(true);
    expect(room.phase).toBe("lobby");
    expect(room.getPlayer("caio")?.spectator).toBe(false);
    expect(room.getPlayer("ana")?.correctChars).toBe(0);
    expect(room.passage).toBeNull();
  });
});

describe("play again", () => {
  test("uses a different passage", () => {
    const room = roomWithTwo();
    room.start("ana", T0, false);
    const first = room.passage?.id;
    room.tick(T0 + COUNTDOWN_MS);
    room.tick(T0 + COUNTDOWN_MS + RACE_TIMEOUT_MS);
    room.playAgain("ana");
    room.start("ana", T0 + 600_000, false);
    expect(room.passage?.id).not.toBe(first);
  });

  test("drops players who disconnected during the last race", () => {
    const room = startedRoom();
    room.leave("bia");
    room.tick(T0 + COUNTDOWN_MS + RACE_TIMEOUT_MS);
    room.playAgain("ana");
    expect(room.playerList.map((player) => player.id)).toEqual(["ana"]);
  });

  test("only the host can ask for it, and only after the race", () => {
    const room = startedRoom();
    expect(room.playAgain("ana")).toMatchObject({ ok: false, code: "wrong_phase" });
    room.tick(T0 + COUNTDOWN_MS + RACE_TIMEOUT_MS);
    expect(room.playAgain("bia")).toMatchObject({ ok: false, code: "not_host" });
  });
});

describe("registry", () => {
  test("creates unique codes from the safe alphabet", () => {
    const registry = new RoomRegistry();
    const a = registry.create(T0);
    const b = registry.create(T0);
    expect(a.code).not.toBe(b.code);
    expect(a.code).toMatch(/^[A-Z2-9]{4}$/);
    expect(generateRoomCode(() => 0)).toBe("AAAA");
  });

  test("a room disappears when everyone leaves", () => {
    const registry = new RoomRegistry();
    const room = registry.create(T0);
    room.join("ana", "Ana");
    expect(registry.sweep(T0 + 1_000)).toEqual([]);
    room.leave("ana");
    expect(registry.sweep(T0 + 2_000)).toEqual([room.code]);
    expect(registry.get(room.code)).toBeUndefined();
  });

  test("a code nobody ever used expires", () => {
    const registry = new RoomRegistry();
    const room = registry.create(T0);
    expect(registry.sweep(T0 + 60_000)).toEqual([]);
    expect(registry.sweep(T0 + 10 * 60_000)).toEqual([room.code]);
  });
});
