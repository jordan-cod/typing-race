import { describe, expect, test } from "bun:test";
import { COUNTDOWN_MS, MAX_PLAYERS_PER_ROOM, RACE_DURATION_MS } from "@typing-race/protocol";
import { generateRoomCode, RoomRegistry } from "../src/race/registry.ts";
import { LATE_REPORT_GRACE_MS, Room } from "../src/race/room.ts";

const T0 = 1_700_000_000_000;
const RACE_START = T0 + COUNTDOWN_MS;
const RACE_END = RACE_START + RACE_DURATION_MS;

function roomWithTwo(): Room {
  const room = new Room("ABCD", () => 0.5);
  room.join("ana", "Ana");
  room.join("bia", "Bia");
  return room;
}

/** Ana criou a sala, então só a Bia precisa dizer que está pronta. */
function roomReadyToStart(): Room {
  const room = roomWithTwo();
  room.setReady("bia", true);
  return room;
}

function startedRoom(): Room {
  const room = roomReadyToStart();
  room.start("ana", T0, false);
  room.tick(RACE_START);
  return room;
}

describe("lobby", () => {
  test("the first player is the host", () => {
    expect(roomWithTwo().hostId).toBe("ana");
  });

  test("only the host can start", () => {
    const room = roomWithTwo();
    expect(room.start("bia", T0, false)).toMatchObject({ ok: false, code: "not_host" });
    expect(room.phase).toBe("lobby");
  });

  test("a lone player cannot start a race by accident", () => {
    const room = new Room("ABCD", () => 0.5);
    room.join("ana", "Ana");
    expect(room.start("ana", T0, false)).toMatchObject({
      ok: false,
      code: "not_enough_players",
    });
    expect(room.phase).toBe("lobby");
  });

  test("solo practice works when it is asked for explicitly", () => {
    const room = new Room("ABCD", () => 0.5);
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

describe("the stream", () => {
  test("the room holds one text, so two players cannot get different words", () => {
    const room = startedRoom();
    expect(room.stream).not.toBeNull();
    expect(room.stream?.length ?? 0).toBeGreaterThan(1_500);
  });

  test("no player can reach the end of it inside a minute", () => {
    const room = startedRoom();
    const streamLength = room.stream?.length ?? 0;
    // Even at the speed ceiling, a full minute of typing leaves text to spare.
    const most = room.applyProgress("ana", streamLength, 0, RACE_END);
    expect(most).toMatchObject({ ok: false, code: "progress_rejected" });
  });

  test("a new race gets new text", () => {
    let calls = 0;
    const room = new Room("ABCD", () => {
      calls += 1;
      return (calls % 7) / 7;
    });
    room.join("ana", "Ana");
    room.join("bia", "Bia");
    room.setReady("bia", true);
    room.start("ana", T0, false);
    const first = room.stream;
    room.tick(RACE_START);
    room.tick(RACE_END);
    room.playAgain("ana");
    room.start("ana", RACE_END, false);
    expect(room.stream).not.toBe(first);
  });
});

describe("countdown", () => {
  test("the start instant comes from the server clock", () => {
    const room = roomReadyToStart();
    room.start("ana", T0, false);
    expect(room.startAt).toBe(RACE_START);
    expect(room.endsAt).toBe(RACE_END);
    expect(room.phase).toBe("countdown");
  });

  test("racing begins only once the instant is reached", () => {
    const room = roomReadyToStart();
    room.start("ana", T0, false);
    expect(room.tick(RACE_START - 1)).toBe(false);
    expect(room.phase).toBe("countdown");
    expect(room.tick(RACE_START)).toBe(true);
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
  test("accepted progress updates the live stats", () => {
    const room = startedRoom();
    const at = RACE_START + 10_000;
    expect(room.applyProgress("ana", 100, 4, at).ok).toBe(true);
    const ana = room.snapshot(at).players.find((player) => player.id === "ana");
    expect(ana?.correctChars).toBe(100);
    expect(ana?.wpm).toBe(120);
    expect(ana?.accuracy).toBeCloseTo(96.2, 1);
  });

  test("a pasted block is rejected and leaves the stored progress alone", () => {
    const room = startedRoom();
    const result = room.applyProgress("ana", 900, 0, RACE_START + 300);
    expect(result).toMatchObject({ ok: false, code: "progress_rejected" });
    expect(room.getPlayer("ana")?.correctChars).toBe(0);
    expect(room.phase).toBe("racing");
  });

  test("a cheater cannot top the ranking of an honest player", () => {
    const room = startedRoom();
    expect(room.applyProgress("bia", 1_400, 0, RACE_START + 500).ok).toBe(false);
    expect(room.applyProgress("ana", 320, 6, RACE_START + 40_000).ok).toBe(true);
    room.tick(RACE_END);

    const players = room.snapshot(RACE_END).players;
    expect(players.find((player) => player.id === "ana")?.rank).toBe(1);
    expect(players.find((player) => player.id === "bia")?.rank).toBe(2);
  });

  test("the ranking is live, so being passed is visible mid-race", () => {
    const room = startedRoom();
    const at = RACE_START + 20_000;
    room.applyProgress("ana", 200, 0, at);
    room.applyProgress("bia", 150, 0, at);
    const leading = room.snapshot(at).players;
    expect(leading.find((player) => player.id === "ana")?.rank).toBe(1);

    room.applyProgress("bia", 260, 0, at + 5_000);
    const passed = room.snapshot(at + 5_000).players;
    expect(passed.find((player) => player.id === "bia")?.rank).toBe(1);
    expect(passed.find((player) => player.id === "ana")?.rank).toBe(2);
  });
});

describe("the minute running out", () => {
  test("the race ends on the server clock, with nobody having to say so", () => {
    const room = startedRoom();
    expect(room.tick(RACE_END - 1)).toBe(false);
    expect(room.phase).toBe("racing");
    expect(room.tick(RACE_END)).toBe(true);
    expect(room.phase).toBe("finished");
  });

  test("the end instant is the scheduled one, not whenever the tick fired", () => {
    const room = startedRoom();
    // A tick that runs 40ms late must not shorten anybody's minute.
    room.tick(RACE_END + 40);
    expect(room.endedAt).toBe(RACE_END);
    room.applyProgress("ana", 300, 0, RACE_END);
    expect(room.snapshot(RACE_END + 5_000).players[0]?.wpm).toBe(60);
  });

  test("stats stop moving once the minute is over", () => {
    const room = startedRoom();
    room.applyProgress("ana", 300, 0, RACE_START + 30_000);
    room.tick(RACE_END);
    const atEnd = room.snapshot(RACE_END).players.find((player) => player.id === "ana");
    const muchLater = room
      .snapshot(RACE_END + 120_000)
      .players.find((player) => player.id === "ana");
    expect(muchLater?.wpm).toBe(atEnd?.wpm);
  });

  test("a report still in flight when the bell rings is counted", () => {
    const room = startedRoom();
    room.tick(RACE_END);
    // Typed at 59.9s, delivered at 60.2s: the network was late, the player was not.
    expect(room.applyProgress("ana", 300, 0, RACE_END + 200).ok).toBe(true);
    expect(room.getPlayer("ana")?.correctChars).toBe(300);
  });

  test("but not a report that arrives long after", () => {
    const room = startedRoom();
    room.tick(RACE_END);
    expect(room.applyProgress("ana", 300, 0, RACE_END + LATE_REPORT_GRACE_MS + 1)).toMatchObject({
      ok: false,
      code: "wrong_phase",
    });
  });

  test("a late report is still measured against a one-minute budget", () => {
    const room = startedRoom();
    room.tick(RACE_END);
    // 1600 characters is beyond even the ceiling for 60s, and the extra 200ms of latency
    // does not buy the room to fit it.
    expect(room.applyProgress("ana", 1_600, 0, RACE_END + 200).ok).toBe(false);
  });
});

describe("disconnects", () => {
  test("a player who drops mid-race does not freeze the others", () => {
    const room = startedRoom();
    const at = RACE_START + 10_000;
    room.applyProgress("bia", 150, 0, at);
    room.leave("bia");
    expect(room.getPlayer("bia")?.connected).toBe(false);

    expect(room.applyProgress("ana", 200, 0, at + 5_000).ok).toBe(true);
    expect(room.phase).toBe("racing");
    room.tick(RACE_END);

    const bia = room.snapshot(RACE_END).players.find((player) => player.id === "bia");
    expect(bia?.rank).toBe(2);
    expect(bia?.correctChars).toBe(150);
    expect(bia?.connected).toBe(false);
  });

  test("the race ends early only when everybody has dropped", () => {
    const room = startedRoom();
    room.leave("ana");
    expect(room.tick(RACE_START + 1_000)).toBe(false);
    room.leave("bia");
    expect(room.tick(RACE_START + 2_000)).toBe(true);
    expect(room.phase).toBe("finished");
    expect(room.isAbandoned).toBe(true);
  });
});

describe("latecomers", () => {
  test("someone arriving mid-race watches instead of racing", () => {
    const room = startedRoom();
    expect(room.join("caio", "Caio")).toMatchObject({ ok: true });
    expect(room.getPlayer("caio")?.spectator).toBe(true);
    expect(room.applyProgress("caio", 10, 0, RACE_START + 5_000)).toMatchObject({
      ok: false,
      code: "wrong_phase",
    });
    const caio = room.snapshot(RACE_START + 5_000).players.find((p) => p.id === "caio");
    expect(caio?.rank).toBeNull();
  });

  test("a spectator becomes a racer in the next race", () => {
    const room = startedRoom();
    room.join("caio", "Caio");
    room.tick(RACE_END);
    expect(room.playAgain("ana").ok).toBe(true);
    expect(room.phase).toBe("lobby");
    expect(room.getPlayer("caio")?.spectator).toBe(false);
    expect(room.getPlayer("ana")?.correctChars).toBe(0);
    expect(room.stream).toBeNull();
  });
});

describe("play again", () => {
  test("drops players who disconnected during the last race", () => {
    const room = startedRoom();
    room.leave("bia");
    room.tick(RACE_END);
    room.playAgain("ana");
    expect(room.playerList.map((player) => player.id)).toEqual(["ana"]);
  });

  test("only the host can ask for it, and only after the race", () => {
    const room = startedRoom();
    expect(room.playAgain("ana")).toMatchObject({ ok: false, code: "wrong_phase" });
    room.tick(RACE_END);
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

describe("everybody ready", () => {
  test("the host cannot start over someone who has not said they are ready", () => {
    const room = roomWithTwo();

    const result = room.start("ana", T0, false);

    expect(result.ok).toBe(false);
    expect(room.phase).toBe("lobby");
  });

  test("the refusal names who is missing, so the host knows who to chase", () => {
    const room = roomWithTwo();
    room.join("caio", "Caio");

    const result = room.start("ana", T0, false);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("Bia");
    if (!result.ok) expect(result.message).toContain("Caio");
  });

  // Starting is the host's way of saying they are ready; asking them to click twice would be
  // ceremony.
  test("the host does not have to mark themselves ready", () => {
    const room = roomReadyToStart();

    expect(room.start("ana", T0, false).ok).toBe(true);
  });

  test("someone who unreadies blocks the start again", () => {
    const room = roomReadyToStart();
    room.setReady("bia", false);

    expect(room.start("ana", T0, false).ok).toBe(false);
  });

  // Ready is about who is racing. A player who dropped cannot click anything.
  test("a disconnected player does not hold the room hostage", () => {
    const room = roomReadyToStart();
    room.join("caio", "Caio");
    room.leave("caio");

    expect(room.start("ana", T0, false).ok).toBe(true);
  });
});

describe("coming back", () => {
  test("returning with the same nickname reclaims the lane, not a second one", () => {
    const room = startedRoom();
    room.applyProgress("bia", 40, 2, RACE_START + 20_000);
    room.leave("bia");

    const result = room.join("bia-2", "Bia");

    expect(result.ok).toBe(true);
    expect(
      room.snapshot(RACE_START + 21_000).players.filter((p) => p.nickname === "Bia"),
    ).toHaveLength(1);
  });

  test("the characters already typed come back with the player", () => {
    const room = startedRoom();
    room.applyProgress("bia", 40, 2, RACE_START + 20_000);
    room.leave("bia");
    room.join("bia-2", "Bia");

    const bia = room.snapshot(RACE_START + 21_000).players.find((p) => p.nickname === "Bia");

    expect(bia?.correctChars).toBe(40);
    expect(bia?.connected).toBe(true);
  });

  // O comando passa adiante quando o dono cai, e voltar não o arranca de volta: a sala
  // continuou funcionando com outra pessoa no comando, e trocar de novo no meio seria pior.
  test("the host role passes on when they drop, and coming back does not take it back", () => {
    const room = startedRoom();
    room.leave("ana");
    expect(room.hostId).toBe("bia");

    room.join("ana-2", "Ana");

    expect(room.hostId).toBe("bia");
    expect(room.getPlayer("ana-2")?.connected).toBe(true);
  });

  // Two people on the same wifi are two players, not one reconnecting.
  test("a nickname still connected is still refused", () => {
    const room = roomWithTwo();

    expect(room.join("outro", "Bia").ok).toBe(false);
  });
});
