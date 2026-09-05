package protocol

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"
)

// ErrInvalid is returned for any frame the browser had no business sending. The caller turns
// it into a single "invalid_message" reply: telling a malformed client exactly which field it
// got wrong is detail it cannot act on.
var ErrInvalid = errors.New("invalid message")

type envelope struct {
	Type string `json:"type"`
}

// ParseClient decodes and validates one frame from a browser.
//
// Everything arriving here is untrusted, so this is the only place the client's word is taken
// for anything: shapes, ranges and lengths are checked once, and the rest of the server works
// with values that are already known to be sane.
func ParseClient(data []byte) (ClientMessage, error) {
	var env envelope
	if err := json.Unmarshal(data, &env); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalid, err)
	}

	decode := func(target ClientMessage) error {
		if err := json.Unmarshal(data, target); err != nil {
			return fmt.Errorf("%w: %v", ErrInvalid, err)
		}
		return nil
	}

	switch env.Type {
	case "join":
		var m Join
		if err := decode(&m); err != nil {
			return nil, err
		}
		code, err := NormalizeRoomCode(m.RoomCode)
		if err != nil {
			return nil, err
		}
		nickname, err := NormalizeNickname(m.Nickname)
		if err != nil {
			return nil, err
		}
		m.RoomCode, m.Nickname = code, nickname
		return m, nil

	case "set_ready":
		var m SetReady
		return m, decode(&m)

	case "start_race":
		var m StartRace
		return m, decode(&m)

	case "set_text_options":
		var m SetTextOptions
		return m, decode(&m)

	case "progress":
		var m Progress
		if err := decode(&m); err != nil {
			return nil, err
		}
		if m.CorrectChars < 0 || m.Errors < 0 {
			return nil, fmt.Errorf("%w: negative progress", ErrInvalid)
		}
		return m, nil

	case "play_again":
		var m PlayAgain
		return m, decode(&m)

	case "ping":
		var m Ping
		return m, decode(&m)
	}

	return nil, fmt.Errorf("%w: unknown type %q", ErrInvalid, env.Type)
}

// NormalizeRoomCode upper-cases and validates a code typed by a human.
func NormalizeRoomCode(raw string) (string, error) {
	code := strings.ToUpper(strings.TrimSpace(raw))
	if utf8.RuneCountInString(code) != RoomCodeLength {
		return "", fmt.Errorf("%w: room code must have %d characters", ErrInvalid, RoomCodeLength)
	}
	for _, r := range code {
		if !strings.ContainsRune(RoomCodeAlphabet, r) {
			return "", fmt.Errorf("%w: %q is not in the room code alphabet", ErrInvalid, r)
		}
	}
	return code, nil
}

// NormalizeNickname trims and validates a nickname.
//
// The length is counted in runes, not bytes: "José" is four characters to the player who
// typed it, and a byte limit would quietly punish accents.
func NormalizeNickname(raw string) (string, error) {
	nickname := strings.TrimSpace(raw)
	length := utf8.RuneCountInString(nickname)
	if length < NicknameMinLength {
		return "", fmt.Errorf("%w: nickname too short", ErrInvalid)
	}
	if length > NicknameMaxLength {
		return "", fmt.Errorf("%w: nickname too long", ErrInvalid)
	}
	return nickname, nil
}
