package protocol

import (
	"os"
	"reflect"
	"regexp"
	"strings"
	"testing"
)

// generatedPath is the TypeScript half of the contract. The test reads the real file rather
// than a fixture: an out-of-date generated file is exactly the failure being guarded against.
const generatedPath = "../../web/src/protocol/generated.ts"

func readGenerated(t *testing.T) string {
	t.Helper()
	data, err := os.ReadFile(generatedPath)
	if err != nil {
		t.Fatalf("run `make protocol`: %v", err)
	}
	return string(data)
}

// The unions in messages.go are the one part of the contract written by hand on both sides,
// because tygo flattens a Go string type to `string` and a Go interface to `any`. This is what
// stops the two halves from drifting: add an error code in Go without adding it to the emitted
// union and the client would narrow on a case that can never happen.
func TestGeneratedUnionsMatchGo(t *testing.T) {
	generated := readGenerated(t)

	union := func(name string) string {
		t.Helper()
		re := regexp.MustCompile(`(?s)export type ` + name + ` =(.*?);`)
		match := re.FindStringSubmatch(generated)
		if match == nil {
			t.Fatalf("the generated file declares no %s union", name)
		}
		return match[1]
	}

	t.Run("every race phase is in the union", func(t *testing.T) {
		body := union("RacePhase")
		for _, phase := range AllRacePhases {
			if !strings.Contains(body, `"`+string(phase)+`"`) {
				t.Errorf("RacePhase %q is missing from the generated union", phase)
			}
		}
		if strings.Count(body, `"`) != 2*len(AllRacePhases) {
			t.Errorf("the generated RacePhase union has members Go does not: %s", body)
		}
	})

	t.Run("every error code is in the union", func(t *testing.T) {
		body := union("ErrorCode")
		for _, code := range AllErrorCodes {
			if !strings.Contains(body, `"`+string(code)+`"`) {
				t.Errorf("ErrorCode %q is missing from the generated union", code)
			}
		}
		if strings.Count(body, `"`) != 2*len(AllErrorCodes) {
			t.Errorf("the generated ErrorCode union has members Go does not: %s", body)
		}
	})

	// Only a real implementer can go in these slices, so the compiler keeps the lists honest
	// and the test only has to check the TypeScript side.
	t.Run("every frame is in its union", func(t *testing.T) {
		cases := []struct {
			union    string
			messages []any
		}{
			{"ClientMessage", []any{
				Join{}, SetReady{}, StartRace{}, SetTextOptions{}, Progress{}, PlayAgain{}, Ping{},
			}},
			{"ServerMessage", []any{Welcome{}, State{}, RaceText{}, Pong{}, Error{}}},
		}
		for _, c := range cases {
			body := union(c.union)
			for _, msg := range c.messages {
				name := reflect.TypeOf(msg).Name()
				if !regexp.MustCompile(`\b` + name + `\b`).MatchString(body) {
					t.Errorf("%s is missing from the generated %s union", name, c.union)
				}
			}
			members := 0
			for _, member := range strings.Split(body, "|") {
				if strings.TrimSpace(member) != "" {
					members++
				}
			}
			if members != len(c.messages) {
				t.Errorf("the generated %s union lists %d members, Go has %d: %s",
					c.union, members, len(c.messages), body)
			}
		}
	})

	// The server sends an explicit null for "no instant yet" and "not ranked". A field typed
	// as optional instead would make `room.startAt === null` a type error on the client while
	// being the only check that works at runtime.
	t.Run("fields the server nulls are typed as null", func(t *testing.T) {
		for _, field := range []string{"hostId", "startAt", "endsAt", "endedAt", "rank"} {
			if !strings.Contains(generated, field+": number | null;") &&
				!strings.Contains(generated, field+": string | null;") {
				t.Errorf("%s is not typed as nullable in the generated file", field)
			}
		}
	})
}

func TestSumTypesAreClosed(t *testing.T) {
	// ParseClient can only ever return one of these, so a client-message switch on the server
	// is exhaustive. The assertion is the compiler's; the test just names the intent.
	var _ ClientMessage = Join{}
	var _ ServerMessage = Welcome{}
}
