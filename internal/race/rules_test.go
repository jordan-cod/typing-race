package race

import (
	"math"
	"testing"

	"github.com/jordan-cod/typing-race/internal/protocol"
)

func TestWPM(t *testing.T) {
	t.Run("counts a word as five characters", func(t *testing.T) {
		// 250 correct chars = 50 words, in exactly one minute.
		if got := WPM(250, protocol.RaceDurationMS); got != 50 {
			t.Errorf("WPM(250, 60s) = %v, want 50", got)
		}
	})

	t.Run("is zero before the clock moves", func(t *testing.T) {
		if got := WPM(0, 0); got != 0 {
			t.Errorf("WPM(0, 0) = %v, want 0", got)
		}
		if got := WPM(100, 0); got != 0 {
			t.Errorf("WPM(100, 0) = %v, want 0", got)
		}
	})

	t.Run("scales with elapsed time", func(t *testing.T) {
		if got := WPM(250, 30_000); got != 100 {
			t.Errorf("WPM(250, 30s) = %v, want 100", got)
		}
	})
}

func TestAccuracy(t *testing.T) {
	cases := []struct {
		name          string
		correct, errs int
		want          float64
	}{
		{"is a share of every keystroke, right or wrong", 90, 10, 90},
		{"perfect minute", 100, 0, 100},
		{"starts at 100 before anything is typed", 0, 0, 100},
		{"drops to zero when nothing lands", 0, 20, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := Accuracy(c.correct, c.errs); got != c.want {
				t.Errorf("Accuracy(%d, %d) = %v, want %v", c.correct, c.errs, got, c.want)
			}
		})
	}
}

func TestCheckProgress(t *testing.T) {
	base := ProgressCandidate{StreamLength: StreamLength, ElapsedMS: 10_000}
	with := func(mutate func(*ProgressCandidate)) ProgressCandidate {
		c := base
		mutate(&c)
		return c
	}

	cases := []struct {
		name      string
		candidate ProgressCandidate
		want      Rejection
	}{
		{
			// 60 chars in 10s is about 144 WPM: fast, but real.
			"accepts a plausible human pace",
			with(func(c *ProgressCandidate) { c.NextChars = 60 }),
			"",
		},
		{
			"rejects a pasted block of text",
			with(func(c *ProgressCandidate) { c.ElapsedMS, c.NextChars = 400, 600 }),
			RejectImpossibleSpeed,
		},
		{
			// 1200 characters is a real 240 WPM minute; claiming it in two seconds is not.
			"rejects a client claiming an impossible minute",
			with(func(c *ProgressCandidate) { c.ElapsedMS, c.NextChars = 2_000, 1_200 }),
			RejectImpossibleSpeed,
		},
		{
			"allows the grace window on the very first report",
			with(func(c *ProgressCandidate) { c.ElapsedMS, c.NextChars = 0, ProgressGraceChars }),
			"",
		},
		{
			"one character past the grace window is not allowed",
			with(func(c *ProgressCandidate) { c.ElapsedMS, c.NextChars = 0, ProgressGraceChars+1 }),
			RejectImpossibleSpeed,
		},
		{
			"sits right on the ceiling without rejecting",
			with(func(c *ProgressCandidate) {
				c.ElapsedMS, c.NextChars = 4_000, ProgressGraceChars+MaxCharsPerSecond*4
			}),
			"",
		},
		{
			"one character over the ceiling is rejected",
			with(func(c *ProgressCandidate) {
				c.ElapsedMS, c.NextChars = 4_000, ProgressGraceChars+MaxCharsPerSecond*4+1
			}),
			RejectImpossibleSpeed,
		},
		{
			"a whole minute at the ceiling is still accepted",
			with(func(c *ProgressCandidate) {
				c.ElapsedMS = protocol.RaceDurationMS
				c.NextChars = ProgressGraceChars + (protocol.RaceDurationMS/1000)*MaxCharsPerSecond
			}),
			"",
		},
		{
			"refuses to go backwards",
			with(func(c *ProgressCandidate) { c.PreviousChars, c.NextChars = 50, 49 }),
			RejectRegressed,
		},
		{
			"refuses to go past the end of the stream",
			with(func(c *ProgressCandidate) { c.NextChars, c.ElapsedMS = StreamLength+1, 600_000 }),
			RejectBeyondStream,
		},
		{
			"refuses to un-type an error",
			with(func(c *ProgressCandidate) { c.PreviousErrors, c.NextErrors = 3, 1 }),
			RejectErrorsRegressed,
		},
		{
			// Two 60-char reports 100ms apart: each delta looks small, the total does not.
			"the cumulative check catches a jump split across reports",
			with(func(c *ProgressCandidate) { c.ElapsedMS, c.NextChars = 100, 60 }),
			RejectImpossibleSpeed,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := CheckProgress(c.candidate); got != c.want {
				t.Errorf("CheckProgress() = %q, want %q", got, c.want)
			}
		})
	}
}

func TestRank(t *testing.T) {
	entry := func(id, nickname string, correct, errs int) Entry {
		return Entry{PlayerID: id, Nickname: nickname, CorrectChars: correct, Errors: errs, Connected: true}
	}
	ids := func(ranked []Ranked) []string {
		out := make([]string, len(ranked))
		for i, r := range ranked {
			out[i] = r.PlayerID
		}
		return out
	}
	ranks := func(ranked []Ranked) []int {
		out := make([]int, len(ranked))
		for i, r := range ranked {
			out[i] = r.Rank
		}
		return out
	}

	t.Run("the most correct characters wins the minute", func(t *testing.T) {
		ranked := Rank([]Entry{
			entry("b", "Bia", 280, 0),
			entry("a", "Ana", 341, 0),
		}, protocol.RaceDurationMS)
		assertStrings(t, ids(ranked), []string{"a", "b"})
		assertInts(t, ranks(ranked), []int{1, 2})
	})

	t.Run("one character decides it, however close the minute was", func(t *testing.T) {
		ranked := Rank([]Entry{
			entry("a", "Ana", 300, 0),
			entry("b", "Bia", 301, 40),
		}, protocol.RaceDurationMS)
		if ranked[0].PlayerID != "b" {
			t.Errorf("winner = %q, want b", ranked[0].PlayerID)
		}
	})

	t.Run("a dead heat on characters is broken by accuracy", func(t *testing.T) {
		ranked := Rank([]Entry{
			entry("sloppy", "Ana", 300, 22),
			entry("clean", "Bia", 300, 3),
		}, protocol.RaceDurationMS)
		assertStrings(t, ids(ranked), []string{"clean", "sloppy"})
		assertInts(t, ranks(ranked), []int{1, 2})
	})

	t.Run("identical on both numbers is a real tie and shares the rank", func(t *testing.T) {
		ranked := Rank([]Entry{
			entry("a", "Ana", 300, 4),
			entry("b", "Bia", 300, 4),
			entry("c", "Caio", 120, 0),
		}, protocol.RaceDurationMS)
		assertInts(t, ranks(ranked), []int{1, 1, 3})
	})

	t.Run("the order never depends on which report arrived first", func(t *testing.T) {
		players := []Entry{
			entry("a", "Ana", 300, 4),
			entry("b", "Bia", 300, 9),
		}
		reversed := []Entry{players[1], players[0]}
		assertStrings(t,
			ids(Rank(players, protocol.RaceDurationMS)),
			ids(Rank(reversed, protocol.RaceDurationMS)),
		)
	})

	t.Run("a player who dropped keeps the characters they typed", func(t *testing.T) {
		quit := entry("quit", "Ana", 90, 0)
		quit.Connected = false
		ranked := Rank([]Entry{quit, entry("here", "Bia", 60, 0)}, protocol.RaceDurationMS)
		// Leaving does not forfeit: they simply stopped adding characters.
		assertStrings(t, ids(ranked), []string{"quit", "here"})
	})

	t.Run("scores everyone over the same minute", func(t *testing.T) {
		ranked := Rank([]Entry{entry("a", "Ana", 250, 50)}, protocol.RaceDurationMS)
		if ranked[0].WPM != 50 {
			t.Errorf("WPM = %v, want 50", ranked[0].WPM)
		}
		if math.Abs(ranked[0].Accuracy-83.3) > 0.05 {
			t.Errorf("accuracy = %v, want ~83.3", ranked[0].Accuracy)
		}
	})
}

func assertStrings(t *testing.T, got, want []string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

func assertInts(t *testing.T, got, want []int) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}
