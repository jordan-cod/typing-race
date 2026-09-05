package race

import (
	"encoding/json"
	"flag"
	"os"
	"testing"
)

var update = flag.Bool("update", false, "rewrite the golden stats file")

// goldenPath is read by the browser's own test suite. The client recomputes WPM and accuracy
// locally so the counters move on every keystroke instead of once per broadcast, which means
// the arithmetic exists twice — the one duplication the generated types cannot remove.
//
// This file is the seam. Go writes it, TypeScript is checked against it, and the moment the
// two disagree one of the two suites goes red instead of the player watching their live WPM
// contradict the result screen.
const goldenPath = "../../web/src/protocol/stats.golden.json"

type goldenCase struct {
	CorrectChars int     `json:"correctChars"`
	Errors       int     `json:"errors"`
	ElapsedMS    int64   `json:"elapsedMs"`
	WPM          float64 `json:"wpm"`
	Accuracy     float64 `json:"accuracy"`
}

func TestStatsGolden(t *testing.T) {
	inputs := []struct {
		correct, errs int
		elapsed       int64
	}{
		{0, 0, 0},          // the race screen opens on this
		{0, 0, 1_000},      // nothing typed yet, clock running
		{100, 0, 0},        // a report that beat the clock
		{250, 0, 60_000},   // exactly 50 wpm
		{250, 50, 60_000},  // the rounding case: 83.3%
		{100, 4, 10_000},   // 120 wpm, 96.2%
		{1, 0, 60_000},     // one character in a minute
		{333, 17, 47_500},  // nothing round anywhere
		{1_512, 0, 60_000}, // the speed ceiling for a whole minute
		{0, 20, 30_000},    // every keystroke wrong
		{7, 3, 3_333},      // small numbers, awkward clock
	}

	cases := make([]goldenCase, 0, len(inputs))
	for _, in := range inputs {
		cases = append(cases, goldenCase{
			CorrectChars: in.correct,
			Errors:       in.errs,
			ElapsedMS:    in.elapsed,
			WPM:          WPM(in.correct, in.elapsed),
			Accuracy:     Accuracy(in.correct, in.errs),
		})
	}

	encoded, err := json.MarshalIndent(cases, "", "  ")
	if err != nil {
		t.Fatalf("encoding: %v", err)
	}
	encoded = append(encoded, '\n')

	if *update {
		if err := os.WriteFile(goldenPath, encoded, 0o644); err != nil {
			t.Fatalf("writing golden file: %v", err)
		}
		t.Log("golden file rewritten")
		return
	}

	committed, err := os.ReadFile(goldenPath)
	if err != nil {
		t.Fatalf("run `make protocol`: %v", err)
	}
	if string(committed) != string(encoded) {
		t.Errorf("the golden stats file is stale; run `make protocol`")
	}
}
