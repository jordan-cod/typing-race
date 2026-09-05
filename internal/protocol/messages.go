// Package protocol is the wire contract between the server and the browser.
//
// It is the single source of truth for both sides: the TypeScript in web/src/protocol is
// generated from this package by tygo (`make protocol`). Nothing here may be duplicated by
// hand on the client, because a contract that exists twice is a contract that drifts, and the
// drift would show up as live WPM disagreeing with the result screen.
package protocol

const (
	RoomCodeLength = 4
	// Ambiguous glyphs (I/O/0/1) are left out so a code read out loud is not misheard.
	RoomCodeAlphabet  = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	MaxPlayersPerRoom = 8
	NicknameMinLength = 2
	NicknameMaxLength = 16
	// How long the countdown lasts. The server publishes an absolute instant, not a duration.
	CountdownMS = 3_000
	// A race is a fixed minute for everyone. Nobody "finishes" — the text never ends — so the
	// race is decided by how far each player got before the clock ran out. A fixed duration
	// also means every race is comparable, which is what makes a personal best worth keeping.
	RaceDurationMS = 60_000
	// Standard typing convention: a "word" is 5 characters, whitespace included.
	CharsPerWord = 5
)

//tygo:emit
var _ = `
export type RacePhase = "lobby" | "countdown" | "racing" | "finished";

export type ErrorCode =
  | "invalid_message"
  | "room_not_found"
  | "room_full"
  | "nickname_taken"
  | "not_joined"
  | "not_host"
  | "not_enough_players"
  | "not_ready"
  | "wrong_phase"
  | "progress_rejected";
`

// TextOptions is what the text is made of.
//
// Both start on: the passages are written in real Portuguese, and that is the thing worth
// practising. Turning them off makes an easier, faster text — useful for a keyboard that
// fights accents, or for a race where everyone wants raw speed.
//
// It lives on the room and not on the player: racing against someone typing different words
// is not racing against anyone.
type TextOptions struct {
	Accents     bool `json:"accents"`
	Punctuation bool `json:"punctuation"`
}

var DefaultTextOptions = TextOptions{Accents: true, Punctuation: true}

// ---------------------------------------------------------------------------
// client -> server
// ---------------------------------------------------------------------------

type Join struct {
	Type     string `json:"type" tstype:"\"join\""`
	RoomCode string `json:"roomCode"`
	Nickname string `json:"nickname"`
}

type SetReady struct {
	Type  string `json:"type" tstype:"\"set_ready\""`
	Ready bool   `json:"ready"`
}

// StartRace carries Solo because racing alone is allowed, but only when the client says so
// explicitly. Without the flag a one-person room is refused, so nobody starts a "race" by
// accident while the second player is still typing their nickname.
type StartRace struct {
	Type string `json:"type" tstype:"\"start_race\""`
	Solo bool   `json:"solo"`
}

type SetTextOptions struct {
	Type        string `json:"type" tstype:"\"set_text_options\""`
	Accents     bool   `json:"accents"`
	Punctuation bool   `json:"punctuation"`
}

type Progress struct {
	Type         string `json:"type" tstype:"\"progress\""`
	CorrectChars int    `json:"correctChars"`
	Errors       int    `json:"errors"`
}

type PlayAgain struct {
	Type string `json:"type" tstype:"\"play_again\""`
}

type Ping struct {
	Type       string  `json:"type" tstype:"\"ping\""`
	ClientTime float64 `json:"clientTime"`
}

//tygo:emit
var _ = `
export type ClientMessage =
  | Join
  | SetReady
  | StartRace
  | SetTextOptions
  | Progress
  | PlayAgain
  | Ping;
`

// ---------------------------------------------------------------------------
// server -> client
// ---------------------------------------------------------------------------

type PlayerSnapshot struct {
	ID       string `json:"id"`
	Nickname string `json:"nickname"`
	IsHost   bool   `json:"isHost"`
	Ready    bool   `json:"ready"`
	// Connected stays false rather than removing the player: dropping out mid-race costs the
	// race but does not erase the minute already typed.
	Connected bool `json:"connected"`
	// Spectator joined after the start, so watches this race without a place in the ranking.
	Spectator    bool    `json:"spectator"`
	CorrectChars int     `json:"correctChars"`
	Errors       int     `json:"errors"`
	WPM          float64 `json:"wpm"`
	Accuracy     float64 `json:"accuracy"`
	// Rank is the live position during the race, not only at the end: being passed is the
	// whole tension. Null for spectators.
	Rank *int `json:"rank" tstype:"number | null,required"`
}

type RoomSnapshot struct {
	Code   string    `json:"code"`
	Phase  RacePhase `json:"phase" tstype:"RacePhase"`
	HostID *string   `json:"hostId" tstype:"string | null,required"`
	// StartAt is the absolute server instant the race starts, in epoch ms, so every client
	// races against the same clock and a slow browser loses nothing but its own countdown.
	StartAt *float64         `json:"startAt" tstype:"number | null,required"`
	EndsAt  *float64         `json:"endsAt" tstype:"number | null,required"`
	EndedAt *float64         `json:"endedAt" tstype:"number | null,required"`
	Players []PlayerSnapshot `json:"players"`
	// TextOptions: everyone sees it, only the host changes it.
	TextOptions TextOptions `json:"textOptions"`
	// ServerTime is the server clock when this snapshot was built, used by clients to correct
	// their offset.
	ServerTime float64 `json:"serverTime"`
}

type Welcome struct {
	Type       string  `json:"type" tstype:"\"welcome\""`
	PlayerID   string  `json:"playerId"`
	Spectator  bool    `json:"spectator"`
	ServerTime float64 `json:"serverTime"`
}

type State struct {
	Type string       `json:"type" tstype:"\"state\""`
	Room RoomSnapshot `json:"room"`
}

// RaceText is the text for one race: a few kilobytes, identical for everyone in the room, and
// constant for the whole minute. It travels on its own message because State is broadcast
// several times a second and there is no reason to resend the words with every frame.
type RaceText struct {
	Type   string `json:"type" tstype:"\"race_text\""`
	Stream string `json:"stream"`
}

type Pong struct {
	Type       string  `json:"type" tstype:"\"pong\""`
	ClientTime float64 `json:"clientTime"`
	ServerTime float64 `json:"serverTime"`
}

type Error struct {
	Type    string    `json:"type" tstype:"\"error\""`
	Code    ErrorCode `json:"code" tstype:"ErrorCode"`
	Message string    `json:"message"`
	// Fatal means the socket is about to be closed by the server.
	Fatal bool `json:"fatal"`
}

//tygo:emit
var _ = `
export type ServerMessage = Welcome | State | RaceText | Pong | Error;
`
