// Package race holds the rules and the state machine of a race. Nothing here does I/O: the
// clock arrives as an argument and there is no socket and no timer, which is what makes the
// rules testable on their own.
package race

import (
	"math"
	"sort"

	"github.com/jordan-cod/typing-race/internal/protocol"
	"golang.org/x/text/collate"
	"golang.org/x/text/language"
)

// MaxCharsPerSecond is the ceiling used to reject impossible progress.
//
// The fastest verified human typists sit around 215 WPM (~18 chars/s) on short bursts. We
// allow 25 chars/s so that a legitimately fast player is never punished, while a paste or a
// scripted client jumping dozens of characters at once is still caught.
const MaxCharsPerSecond = 25

// ProgressGraceChars is forgiven on top of the speed ceiling.
//
// Progress reports are batched (we do not send one message per keystroke) and the client clock
// is only roughly aligned with the server's, so the very first report of a race can
// legitimately look faster than a human. A fixed allowance absorbs that without opening a hole
// big enough to paste a paragraph through.
const ProgressGraceChars = 12

type Rejection string

const (
	RejectRegressed       Rejection = "regressed"
	RejectBeyondStream    Rejection = "beyond_stream"
	RejectErrorsRegressed Rejection = "errors_regressed"
	RejectImpossibleSpeed Rejection = "impossible_speed"
)

// Message is what the player is told. The rejection reasons the player can do nothing about
// collapse into one generic line.
func (r Rejection) Message() string {
	switch r {
	case RejectImpossibleSpeed:
		return "Progresso invalido: rapido demais para ser digitado"
	case RejectBeyondStream:
		return "Progresso invalido: passou do fim do texto"
	default:
		return "Progresso invalido"
	}
}

type ProgressCandidate struct {
	PreviousChars  int
	NextChars      int
	PreviousErrors int
	NextErrors     int
	StreamLength   int
	ElapsedMS      int64
}

// CheckProgress validates a progress report against the previous accepted one. An empty
// Rejection means the report is good.
//
// The speed check is cumulative (from the race start, not from the previous report) on
// purpose: checking each delta in isolation would let a cheater drip-feed a large jump across
// several messages and still end the minute with an impossible total.
func CheckProgress(c ProgressCandidate) Rejection {
	switch {
	case c.NextChars < c.PreviousChars:
		return RejectRegressed
	case c.NextChars > c.StreamLength:
		return RejectBeyondStream
	case c.NextErrors < c.PreviousErrors:
		return RejectErrorsRegressed
	case c.ElapsedMS < 0:
		return RejectImpossibleSpeed
	}

	maxChars := ProgressGraceChars + float64(c.ElapsedMS)/1000*MaxCharsPerSecond
	if float64(c.NextChars) > maxChars {
		return RejectImpossibleSpeed
	}
	return ""
}

// WPM is the net rate over the characters the player actually got right.
func WPM(correctChars int, elapsedMS int64) float64 {
	if elapsedMS <= 0 || correctChars <= 0 {
		return 0
	}
	minutes := float64(elapsedMS) / 60_000
	return round1(float64(correctChars) / protocol.CharsPerWord / minutes)
}

// Accuracy is the percentage of keystrokes that landed on the right character.
//
// A player who has not typed anything yet is shown 100 rather than 0 so the race screen does
// not open on a discouraging number.
func Accuracy(correctChars, errors int) float64 {
	total := correctChars + errors
	if total <= 0 {
		return 100
	}
	return round1(float64(correctChars) / float64(total) * 100)
}

type Entry struct {
	PlayerID     string
	Nickname     string
	CorrectChars int
	Errors       int
	Connected    bool
}

type Ranked struct {
	Entry
	Rank     int
	WPM      float64
	Accuracy float64
}

// ptBR orders the nicknames the way a Brazilian reader expects, so "Ávila" lands next to
// "Avila" instead of after "Zoe".
var ptBR = collate.New(language.BrazilianPortuguese)

// Rank produces the ordering used both live during the minute and for the final result.
//
// Most correct characters wins, because that is the only thing the whole minute was spent on.
// A dead heat on characters is broken by accuracy: between two players who typed exactly as
// much, the one who hit fewer wrong keys did the better minute. Only when both numbers match
// is it a real tie, and then the two share a rank, so a 1-1-3 podium is possible.
//
// Nothing here looks at who reported first: two players finishing the minute within
// milliseconds of each other must not have the result decided by network luck.
func Rank(entries []Entry, elapsedMS int64) []Ranked {
	sorted := make([]Entry, len(entries))
	copy(sorted, entries)
	sort.SliceStable(sorted, func(i, j int) bool {
		a, b := sorted[i], sorted[j]
		if a.CorrectChars != b.CorrectChars {
			return a.CorrectChars > b.CorrectChars
		}
		if a.Errors != b.Errors {
			return a.Errors < b.Errors
		}
		return ptBR.CompareString(a.Nickname, b.Nickname) < 0
	})

	ranked := make([]Ranked, 0, len(sorted))
	currentRank := 0
	for i, entry := range sorted {
		if i == 0 || !deadHeat(sorted[i-1], entry) {
			currentRank = i + 1
		}
		ranked = append(ranked, Ranked{
			Entry:    entry,
			Rank:     currentRank,
			WPM:      WPM(entry.CorrectChars, elapsedMS),
			Accuracy: Accuracy(entry.CorrectChars, entry.Errors),
		})
	}
	return ranked
}

func deadHeat(a, b Entry) bool {
	return a.CorrectChars == b.CorrectChars && a.Errors == b.Errors
}

func round1(v float64) float64 { return math.Round(v*10) / 10 }
