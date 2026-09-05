package protocol

import (
	"errors"
	"strings"
	"testing"
)

func TestParseClient(t *testing.T) {
	t.Run("reads a join and normalises what the player typed", func(t *testing.T) {
		msg, err := ParseClient([]byte(`{"type":"join","roomCode":" abcd ","nickname":"  Ana  "}`))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		join, ok := msg.(Join)
		if !ok {
			t.Fatalf("got %T, want Join", msg)
		}
		if join.RoomCode != "ABCD" {
			t.Errorf("roomCode = %q, want ABCD", join.RoomCode)
		}
		if join.Nickname != "Ana" {
			t.Errorf("nickname = %q, want Ana", join.Nickname)
		}
	})

	// The TypeScript server had to check this by hand because a JSON number is a float there.
	// Here the field is an int, so a fractional count cannot survive decoding — but it still
	// has to be refused rather than truncated to 10.
	t.Run("refuses fractional counts", func(t *testing.T) {
		if _, err := ParseClient([]byte(`{"type":"progress","correctChars":10.5,"errors":0}`)); err == nil {
			t.Error("10.5 characters was accepted")
		}
	})

	cases := []struct {
		name string
		raw  string
	}{
		{"not JSON at all", `not json`},
		{"a type nobody serves", `{"type":"launch_missiles"}`},
		{"no type at all", `{"roomCode":"ABCD"}`},
		{"a room code with an ambiguous glyph", `{"type":"join","roomCode":"AB0D","nickname":"Ana"}`},
		{"a room code of the wrong length", `{"type":"join","roomCode":"ABC","nickname":"Ana"}`},
		{"a nickname of one character", `{"type":"join","roomCode":"ABCD","nickname":"A"}`},
		{"negative progress", `{"type":"progress","correctChars":-1,"errors":0}`},
		{"negative errors", `{"type":"progress","correctChars":0,"errors":-3}`},
	}
	for _, c := range cases {
		t.Run("refuses "+c.name, func(t *testing.T) {
			if _, err := ParseClient([]byte(c.raw)); !errors.Is(err, ErrInvalid) {
				t.Errorf("got %v, want ErrInvalid", err)
			}
		})
	}
}

func TestNormalizeNickname(t *testing.T) {
	// Counted in runes, not bytes: "José" is four characters to the player who typed it, and a
	// byte limit would quietly punish accents.
	t.Run("measures accented names the way the player sees them", func(t *testing.T) {
		name := strings.Repeat("á", NicknameMaxLength)
		if _, err := NormalizeNickname(name); err != nil {
			t.Errorf("%d accented characters were refused: %v", NicknameMaxLength, err)
		}
		if _, err := NormalizeNickname(name + "á"); err == nil {
			t.Error("a name one character too long was accepted")
		}
	})
}
