package protocol

// The closed vocabularies of the protocol.
//
// Every type in this file has a hand-written twin in the generated TypeScript, emitted by a
// //tygo:emit block in messages.go: tygo turns a Go string type into `string`, which would
// throw away exactly the checking these exist for. TestGeneratedUnionsMatchGo keeps the two
// halves honest.

type RacePhase string

const (
	PhaseLobby     RacePhase = "lobby"
	PhaseCountdown RacePhase = "countdown"
	PhaseRacing    RacePhase = "racing"
	PhaseFinished  RacePhase = "finished"
)

type ErrorCode string

const (
	ErrInvalidMessage   ErrorCode = "invalid_message"
	ErrRoomNotFound     ErrorCode = "room_not_found"
	ErrRoomFull         ErrorCode = "room_full"
	ErrNicknameTaken    ErrorCode = "nickname_taken"
	ErrNotJoined        ErrorCode = "not_joined"
	ErrNotHost          ErrorCode = "not_host"
	ErrNotEnoughPlayers ErrorCode = "not_enough_players"
	ErrNotReady         ErrorCode = "not_ready"
	ErrWrongPhase       ErrorCode = "wrong_phase"
	ErrProgressRejected ErrorCode = "progress_rejected"
)

// AllRacePhases and AllErrorCodes exist so the generated TypeScript can be checked against
// them; nothing at runtime iterates either.
var AllRacePhases = []RacePhase{PhaseLobby, PhaseCountdown, PhaseRacing, PhaseFinished}

var AllErrorCodes = []ErrorCode{
	ErrInvalidMessage, ErrRoomNotFound, ErrRoomFull, ErrNicknameTaken, ErrNotJoined,
	ErrNotHost, ErrNotEnoughPlayers, ErrNotReady, ErrWrongPhase, ErrProgressRejected,
}

// The two closed sets of frames.
//
// The marker methods are what make these sum types: nothing outside this package can add a
// case, so a type switch over them is exhaustive by construction. They live apart from the
// message structs because tygo generates the TypeScript from that file, and a Go interface has
// no useful translation — the unions on the other side are emitted by hand next to the structs
// they list.
type ClientMessage interface{ isClientMessage() }

func (Join) isClientMessage()           {}
func (SetReady) isClientMessage()       {}
func (StartRace) isClientMessage()      {}
func (SetTextOptions) isClientMessage() {}
func (Progress) isClientMessage()       {}
func (PlayAgain) isClientMessage()      {}
func (Ping) isClientMessage()           {}

type ServerMessage interface{ isServerMessage() }

func (Welcome) isServerMessage()  {}
func (State) isServerMessage()    {}
func (RaceText) isServerMessage() {}
func (Pong) isServerMessage()     {}
func (Error) isServerMessage()    {}
