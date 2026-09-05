package race

import (
	"math/rand/v2"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/jordan-cod/typing-race/internal/protocol"
)

var (
	t0        = time.UnixMilli(1_700_000_000_000).UTC()
	raceStart = t0.Add(countdown)
	raceEnd   = raceStart.Add(raceDuration)
)

func newTestRoom() *Room { return NewRoom("ABCD", rand.New(rand.NewPCG(7, 11))) }

func roomWithTwo(t *testing.T) *Room {
	t.Helper()
	room := newTestRoom()
	mustJoin(t, room, "ana", "Ana")
	mustJoin(t, room, "bia", "Bia")
	return room
}

// Ana criou a sala, então só a Bia precisa dizer que está pronta.
func roomReadyToStart(t *testing.T) *Room {
	t.Helper()
	room := roomWithTwo(t)
	mustOK(t, room.SetReady("bia", true))
	return room
}

func startedRoom(t *testing.T) *Room {
	t.Helper()
	room := roomReadyToStart(t)
	mustOK(t, room.Start("ana", t0, false))
	room.Tick(raceStart)
	return room
}

func mustJoin(t *testing.T, room *Room, id, nickname string) *Player {
	t.Helper()
	player, failure := room.Join(id, nickname)
	if failure != nil {
		t.Fatalf("join(%q): %v", nickname, failure)
	}
	return player
}

func mustOK(t *testing.T, failure *Failure) {
	t.Helper()
	if failure != nil {
		t.Fatalf("unexpected refusal: %s (%s)", failure.Message, failure.Code)
	}
}

func mustFail(t *testing.T, failure *Failure, code protocol.ErrorCode) *Failure {
	t.Helper()
	if failure == nil {
		t.Fatalf("expected %s, got success", code)
	}
	if failure.Code != code {
		t.Fatalf("expected %s, got %s (%s)", code, failure.Code, failure.Message)
	}
	return failure
}

func snapshotPlayer(t *testing.T, room *Room, at time.Time, id string) protocol.PlayerSnapshot {
	t.Helper()
	for _, p := range room.Snapshot(at).Players {
		if p.ID == id {
			return p
		}
	}
	t.Fatalf("player %q is not in the snapshot", id)
	return protocol.PlayerSnapshot{}
}

func TestLobby(t *testing.T) {
	t.Run("the first player is the host", func(t *testing.T) {
		if got := roomWithTwo(t).HostID; got != "ana" {
			t.Errorf("host = %q, want ana", got)
		}
	})

	t.Run("only the host can start", func(t *testing.T) {
		room := roomWithTwo(t)
		mustFail(t, room.Start("bia", t0, false), protocol.ErrNotHost)
		if room.Phase != protocol.PhaseLobby {
			t.Errorf("phase = %q, want lobby", room.Phase)
		}
	})

	t.Run("a lone player cannot start a race by accident", func(t *testing.T) {
		room := newTestRoom()
		mustJoin(t, room, "ana", "Ana")
		mustFail(t, room.Start("ana", t0, false), protocol.ErrNotEnoughPlayers)
		if room.Phase != protocol.PhaseLobby {
			t.Errorf("phase = %q, want lobby", room.Phase)
		}
	})

	t.Run("solo practice works when it is asked for explicitly", func(t *testing.T) {
		room := newTestRoom()
		mustJoin(t, room, "ana", "Ana")
		mustOK(t, room.Start("ana", t0, true))
		if room.Phase != protocol.PhaseCountdown {
			t.Errorf("phase = %q, want countdown", room.Phase)
		}
	})

	t.Run("refuses a duplicate nickname and a full room", func(t *testing.T) {
		room := roomWithTwo(t)
		_, failure := room.Join("x", "ANA")
		mustFail(t, failure, protocol.ErrNicknameTaken)

		for i := len(room.Players()); i < protocol.MaxPlayersPerRoom; i++ {
			mustJoin(t, room, "p"+string(rune('a'+i)), "Player"+string(rune('a'+i)))
		}
		_, failure = room.Join("extra", "Extra")
		mustFail(t, failure, protocol.ErrRoomFull)
	})

	t.Run("host passes to another player when the host leaves", func(t *testing.T) {
		room := roomWithTwo(t)
		room.Leave("ana")
		if room.HostID != "bia" {
			t.Errorf("host = %q, want bia", room.HostID)
		}
		if len(room.Players()) != 1 {
			t.Errorf("players = %d, want 1", len(room.Players()))
		}
	})
}

func TestStream(t *testing.T) {
	t.Run("the room holds one text, so two players cannot get different words", func(t *testing.T) {
		room := startedRoom(t)
		if utf8.RuneCountInString(room.Stream) <= 1_500 {
			t.Errorf("stream is %d characters, want more than 1500", utf8.RuneCountInString(room.Stream))
		}
	})

	t.Run("no player can reach the end of it inside a minute", func(t *testing.T) {
		room := startedRoom(t)
		// Even at the speed ceiling, a full minute of typing leaves text to spare.
		length := utf8.RuneCountInString(room.Stream)
		mustFail(t, room.ApplyProgress("ana", length, 0, raceEnd), protocol.ErrProgressRejected)
	})

	t.Run("a new race gets new text", func(t *testing.T) {
		room := startedRoom(t)
		first := room.Stream
		room.Tick(raceEnd)
		mustOK(t, room.PlayAgain("ana"))
		mustOK(t, room.SetReady("bia", true))
		mustOK(t, room.Start("ana", raceEnd, false))
		if room.Stream == first {
			t.Error("the second race reused the first race's text")
		}
	})
}

func TestCountdown(t *testing.T) {
	t.Run("the start instant comes from the server clock", func(t *testing.T) {
		room := roomReadyToStart(t)
		mustOK(t, room.Start("ana", t0, false))
		if !room.StartAt.Equal(raceStart) {
			t.Errorf("startAt = %v, want %v", room.StartAt, raceStart)
		}
		if !room.EndsAt().Equal(raceEnd) {
			t.Errorf("endsAt = %v, want %v", room.EndsAt(), raceEnd)
		}
		if room.Phase != protocol.PhaseCountdown {
			t.Errorf("phase = %q, want countdown", room.Phase)
		}
	})

	t.Run("racing begins only once the instant is reached", func(t *testing.T) {
		room := roomReadyToStart(t)
		mustOK(t, room.Start("ana", t0, false))
		if room.Tick(raceStart.Add(-time.Millisecond)) {
			t.Error("tick before the start changed the phase")
		}
		if room.Phase != protocol.PhaseCountdown {
			t.Errorf("phase = %q, want countdown", room.Phase)
		}
		if !room.Tick(raceStart) {
			t.Error("tick at the start did not change the phase")
		}
		if room.Phase != protocol.PhaseRacing {
			t.Errorf("phase = %q, want racing", room.Phase)
		}
	})

	t.Run("progress sent during the countdown is refused", func(t *testing.T) {
		room := roomReadyToStart(t)
		mustOK(t, room.Start("ana", t0, false))
		mustFail(t, room.ApplyProgress("ana", 5, 0, t0.Add(100*time.Millisecond)), protocol.ErrWrongPhase)
	})
}

func TestProgress(t *testing.T) {
	t.Run("accepted progress updates the live stats", func(t *testing.T) {
		room := startedRoom(t)
		at := raceStart.Add(10 * time.Second)
		mustOK(t, room.ApplyProgress("ana", 100, 4, at))

		ana := snapshotPlayer(t, room, at, "ana")
		if ana.CorrectChars != 100 {
			t.Errorf("correctChars = %d, want 100", ana.CorrectChars)
		}
		if ana.WPM != 120 {
			t.Errorf("wpm = %v, want 120", ana.WPM)
		}
		if ana.Accuracy != 96.2 {
			t.Errorf("accuracy = %v, want 96.2", ana.Accuracy)
		}
	})

	t.Run("a pasted block is rejected and leaves the stored progress alone", func(t *testing.T) {
		room := startedRoom(t)
		mustFail(t, room.ApplyProgress("ana", 900, 0, raceStart.Add(300*time.Millisecond)),
			protocol.ErrProgressRejected)
		if room.Player("ana").CorrectChars != 0 {
			t.Errorf("stored progress moved to %d", room.Player("ana").CorrectChars)
		}
		if room.Phase != protocol.PhaseRacing {
			t.Errorf("phase = %q, want racing", room.Phase)
		}
	})

	t.Run("a cheater cannot top the ranking of an honest player", func(t *testing.T) {
		room := startedRoom(t)
		mustFail(t, room.ApplyProgress("bia", 1_400, 0, raceStart.Add(500*time.Millisecond)),
			protocol.ErrProgressRejected)
		mustOK(t, room.ApplyProgress("ana", 320, 6, raceStart.Add(40*time.Second)))
		room.Tick(raceEnd)

		if rank := snapshotPlayer(t, room, raceEnd, "ana").Rank; rank == nil || *rank != 1 {
			t.Errorf("ana rank = %v, want 1", rank)
		}
		if rank := snapshotPlayer(t, room, raceEnd, "bia").Rank; rank == nil || *rank != 2 {
			t.Errorf("bia rank = %v, want 2", rank)
		}
	})

	t.Run("the ranking is live, so being passed is visible mid-race", func(t *testing.T) {
		room := startedRoom(t)
		at := raceStart.Add(20 * time.Second)
		mustOK(t, room.ApplyProgress("ana", 200, 0, at))
		mustOK(t, room.ApplyProgress("bia", 150, 0, at))
		if rank := snapshotPlayer(t, room, at, "ana").Rank; rank == nil || *rank != 1 {
			t.Errorf("ana rank = %v, want 1", rank)
		}

		later := at.Add(5 * time.Second)
		mustOK(t, room.ApplyProgress("bia", 260, 0, later))
		if rank := snapshotPlayer(t, room, later, "bia").Rank; rank == nil || *rank != 1 {
			t.Errorf("bia rank = %v, want 1", rank)
		}
		if rank := snapshotPlayer(t, room, later, "ana").Rank; rank == nil || *rank != 2 {
			t.Errorf("ana rank = %v, want 2", rank)
		}
	})
}

func TestTheMinuteRunningOut(t *testing.T) {
	t.Run("the race ends on the server clock, with nobody having to say so", func(t *testing.T) {
		room := startedRoom(t)
		if room.Tick(raceEnd.Add(-time.Millisecond)) {
			t.Error("tick before the bell ended the race")
		}
		if room.Phase != protocol.PhaseRacing {
			t.Errorf("phase = %q, want racing", room.Phase)
		}
		if !room.Tick(raceEnd) {
			t.Error("tick at the bell did not end the race")
		}
		if room.Phase != protocol.PhaseFinished {
			t.Errorf("phase = %q, want finished", room.Phase)
		}
	})

	t.Run("the end instant is the scheduled one, not whenever the tick fired", func(t *testing.T) {
		room := startedRoom(t)
		// A tick that runs 40ms late must not shorten anybody's minute.
		room.Tick(raceEnd.Add(40 * time.Millisecond))
		if !room.EndedAt.Equal(raceEnd) {
			t.Errorf("endedAt = %v, want %v", room.EndedAt, raceEnd)
		}
		mustOK(t, room.ApplyProgress("ana", 300, 0, raceEnd))
		if wpm := snapshotPlayer(t, room, raceEnd.Add(5*time.Second), "ana").WPM; wpm != 60 {
			t.Errorf("wpm = %v, want 60", wpm)
		}
	})

	t.Run("stats stop moving once the minute is over", func(t *testing.T) {
		room := startedRoom(t)
		mustOK(t, room.ApplyProgress("ana", 300, 0, raceStart.Add(30*time.Second)))
		room.Tick(raceEnd)
		atEnd := snapshotPlayer(t, room, raceEnd, "ana").WPM
		muchLater := snapshotPlayer(t, room, raceEnd.Add(2*time.Minute), "ana").WPM
		if atEnd != muchLater {
			t.Errorf("wpm drifted from %v to %v after the race", atEnd, muchLater)
		}
	})

	t.Run("a report still in flight when the bell rings is counted", func(t *testing.T) {
		room := startedRoom(t)
		room.Tick(raceEnd)
		// Typed at 59.9s, delivered at 60.2s: the network was late, the player was not.
		mustOK(t, room.ApplyProgress("ana", 300, 0, raceEnd.Add(200*time.Millisecond)))
		if room.Player("ana").CorrectChars != 300 {
			t.Errorf("correctChars = %d, want 300", room.Player("ana").CorrectChars)
		}
	})

	t.Run("but not a report that arrives long after", func(t *testing.T) {
		room := startedRoom(t)
		room.Tick(raceEnd)
		mustFail(t, room.ApplyProgress("ana", 300, 0, raceEnd.Add(LateReportGrace+time.Millisecond)),
			protocol.ErrWrongPhase)
	})

	t.Run("a late report is still measured against a one-minute budget", func(t *testing.T) {
		room := startedRoom(t)
		room.Tick(raceEnd)
		// 1600 characters is beyond even the ceiling for 60s, and the extra 200ms of latency
		// does not buy the room to fit it.
		mustFail(t, room.ApplyProgress("ana", 1_600, 0, raceEnd.Add(200*time.Millisecond)),
			protocol.ErrProgressRejected)
	})
}

func TestDisconnects(t *testing.T) {
	t.Run("a player who drops mid-race does not freeze the others", func(t *testing.T) {
		room := startedRoom(t)
		at := raceStart.Add(10 * time.Second)
		mustOK(t, room.ApplyProgress("bia", 150, 0, at))
		room.Leave("bia")
		if room.Player("bia").Connected {
			t.Error("bia is still marked connected")
		}

		mustOK(t, room.ApplyProgress("ana", 200, 0, at.Add(5*time.Second)))
		if room.Phase != protocol.PhaseRacing {
			t.Errorf("phase = %q, want racing", room.Phase)
		}
		room.Tick(raceEnd)

		bia := snapshotPlayer(t, room, raceEnd, "bia")
		if bia.Rank == nil || *bia.Rank != 2 {
			t.Errorf("bia rank = %v, want 2", bia.Rank)
		}
		if bia.CorrectChars != 150 {
			t.Errorf("bia correctChars = %d, want 150", bia.CorrectChars)
		}
		if bia.Connected {
			t.Error("bia is reported as connected")
		}
	})

	t.Run("the race ends early only when everybody has dropped", func(t *testing.T) {
		room := startedRoom(t)
		room.Leave("ana")
		if room.Tick(raceStart.Add(time.Second)) {
			t.Error("one player leaving ended the race")
		}
		room.Leave("bia")
		if !room.Tick(raceStart.Add(2 * time.Second)) {
			t.Error("an empty race kept running")
		}
		if room.Phase != protocol.PhaseFinished {
			t.Errorf("phase = %q, want finished", room.Phase)
		}
		if !room.Abandoned() {
			t.Error("room is not abandoned")
		}
	})
}

func TestLatecomers(t *testing.T) {
	t.Run("someone arriving mid-race watches instead of racing", func(t *testing.T) {
		room := startedRoom(t)
		caio := mustJoin(t, room, "caio", "Caio")
		if !caio.Spectator {
			t.Error("caio is not a spectator")
		}
		at := raceStart.Add(5 * time.Second)
		mustFail(t, room.ApplyProgress("caio", 10, 0, at), protocol.ErrWrongPhase)
		if rank := snapshotPlayer(t, room, at, "caio").Rank; rank != nil {
			t.Errorf("caio rank = %v, want null", *rank)
		}
	})

	t.Run("a spectator becomes a racer in the next race", func(t *testing.T) {
		room := startedRoom(t)
		mustJoin(t, room, "caio", "Caio")
		room.Tick(raceEnd)
		mustOK(t, room.PlayAgain("ana"))
		if room.Phase != protocol.PhaseLobby {
			t.Errorf("phase = %q, want lobby", room.Phase)
		}
		if room.Player("caio").Spectator {
			t.Error("caio is still a spectator")
		}
		if room.Player("ana").CorrectChars != 0 {
			t.Error("ana kept last race's characters")
		}
		if room.Stream != "" {
			t.Error("the lobby still holds the last race's text")
		}
	})
}

func TestPlayAgain(t *testing.T) {
	t.Run("drops players who disconnected during the last race", func(t *testing.T) {
		room := startedRoom(t)
		room.Leave("bia")
		room.Tick(raceEnd)
		mustOK(t, room.PlayAgain("ana"))
		if len(room.Players()) != 1 || room.Players()[0].ID != "ana" {
			t.Errorf("players = %v, want only ana", room.Players())
		}
	})

	t.Run("only the host can ask for it, and only after the race", func(t *testing.T) {
		room := startedRoom(t)
		mustFail(t, room.PlayAgain("ana"), protocol.ErrWrongPhase)
		room.Tick(raceEnd)
		mustFail(t, room.PlayAgain("bia"), protocol.ErrNotHost)
	})
}

func TestEverybodyReady(t *testing.T) {
	t.Run("the host cannot start over someone who has not said they are ready", func(t *testing.T) {
		room := roomWithTwo(t)
		mustFail(t, room.Start("ana", t0, false), protocol.ErrNotReady)
		if room.Phase != protocol.PhaseLobby {
			t.Errorf("phase = %q, want lobby", room.Phase)
		}
	})

	t.Run("the refusal names who is missing, so the host knows who to chase", func(t *testing.T) {
		room := roomWithTwo(t)
		mustJoin(t, room, "caio", "Caio")
		failure := mustFail(t, room.Start("ana", t0, false), protocol.ErrNotReady)
		for _, name := range []string{"Bia", "Caio"} {
			if !strings.Contains(failure.Message, name) {
				t.Errorf("refusal %q does not name %s", failure.Message, name)
			}
		}
	})

	// Starting is the host's way of saying they are ready; asking them to click twice would be
	// ceremony.
	t.Run("the host does not have to mark themselves ready", func(t *testing.T) {
		mustOK(t, roomReadyToStart(t).Start("ana", t0, false))
	})

	t.Run("someone who unreadies blocks the start again", func(t *testing.T) {
		room := roomReadyToStart(t)
		mustOK(t, room.SetReady("bia", false))
		mustFail(t, room.Start("ana", t0, false), protocol.ErrNotReady)
	})

	// Ready is about who is racing. A player who dropped cannot click anything.
	t.Run("a disconnected player does not hold the room hostage", func(t *testing.T) {
		room := roomReadyToStart(t)
		mustJoin(t, room, "caio", "Caio")
		room.Leave("caio")
		mustOK(t, room.Start("ana", t0, false))
	})
}

func TestComingBack(t *testing.T) {
	t.Run("returning with the same nickname reclaims the lane, not a second one", func(t *testing.T) {
		room := startedRoom(t)
		mustOK(t, room.ApplyProgress("bia", 40, 2, raceStart.Add(20*time.Second)))
		room.Leave("bia")
		mustJoin(t, room, "bia-2", "Bia")

		lanes := 0
		for _, p := range room.Snapshot(raceStart.Add(21 * time.Second)).Players {
			if p.Nickname == "Bia" {
				lanes++
			}
		}
		if lanes != 1 {
			t.Errorf("Bia has %d lanes, want 1", lanes)
		}
	})

	t.Run("the characters already typed come back with the player", func(t *testing.T) {
		room := startedRoom(t)
		mustOK(t, room.ApplyProgress("bia", 40, 2, raceStart.Add(20*time.Second)))
		room.Leave("bia")
		mustJoin(t, room, "bia-2", "Bia")

		bia := snapshotPlayer(t, room, raceStart.Add(21*time.Second), "bia-2")
		if bia.CorrectChars != 40 {
			t.Errorf("correctChars = %d, want 40", bia.CorrectChars)
		}
		if !bia.Connected {
			t.Error("bia came back disconnected")
		}
	})

	// O comando passa adiante quando o dono cai, e voltar não o arranca de volta: a sala
	// continuou funcionando com outra pessoa no comando, e trocar de novo no meio seria pior.
	t.Run("the host role passes on when they drop, and coming back does not take it back", func(t *testing.T) {
		room := startedRoom(t)
		room.Leave("ana")
		if room.HostID != "bia" {
			t.Fatalf("host = %q, want bia", room.HostID)
		}
		mustJoin(t, room, "ana-2", "Ana")
		if room.HostID != "bia" {
			t.Errorf("host = %q, want bia", room.HostID)
		}
		if !room.Player("ana-2").Connected {
			t.Error("ana came back disconnected")
		}
	})

	// Two people on the same wifi are two players, not one reconnecting.
	t.Run("a nickname still connected is still refused", func(t *testing.T) {
		room := roomWithTwo(t)
		_, failure := room.Join("outro", "Bia")
		mustFail(t, failure, protocol.ErrNicknameTaken)
	})
}

func TestRegistry(t *testing.T) {
	t.Run("creates unique codes from the safe alphabet", func(t *testing.T) {
		reg := NewRegistry(rand.New(rand.NewPCG(3, 5)))
		a := reg.Create(t0)
		b := reg.Create(t0)
		if a.Code == b.Code {
			t.Error("two rooms got the same code")
		}
		for _, room := range []*Room{a, b} {
			if len(room.Code) != protocol.RoomCodeLength {
				t.Errorf("code %q is not %d characters", room.Code, protocol.RoomCodeLength)
			}
			// I, O, 0 and 1 are left out so a code read out loud is not misheard.
			if strings.ContainsAny(room.Code, "IO01") {
				t.Errorf("code %q uses an ambiguous glyph", room.Code)
			}
		}
	})

	t.Run("a room disappears when everyone leaves", func(t *testing.T) {
		reg := NewRegistry(rand.New(rand.NewPCG(3, 5)))
		room := reg.Create(t0)
		mustJoin(t, room, "ana", "Ana")
		if swept := reg.Sweep(t0.Add(time.Second)); len(swept) != 0 {
			t.Errorf("swept %v while somebody was in the room", swept)
		}
		room.Leave("ana")
		swept := reg.Sweep(t0.Add(2 * time.Second))
		if len(swept) != 1 || swept[0] != room.Code {
			t.Errorf("swept %v, want [%s]", swept, room.Code)
		}
		if reg.Get(room.Code) != nil {
			t.Error("the room is still in the registry")
		}
	})

	t.Run("a code nobody ever used expires", func(t *testing.T) {
		reg := NewRegistry(rand.New(rand.NewPCG(3, 5)))
		room := reg.Create(t0)
		if swept := reg.Sweep(t0.Add(time.Minute)); len(swept) != 0 {
			t.Errorf("swept %v before the TTL was up", swept)
		}
		swept := reg.Sweep(t0.Add(10 * time.Minute))
		if len(swept) != 1 || swept[0] != room.Code {
			t.Errorf("swept %v, want [%s]", swept, room.Code)
		}
	})
}
