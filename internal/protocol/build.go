package protocol

// Constructors for the server-to-client frames.
//
// They exist so the `type` discriminant is written in exactly one place per message. Building
// the structs by hand would make it possible to send a Welcome tagged "state", which is a
// class of bug the compiler cannot catch on its own.

func NewWelcome(playerID string, spectator bool, serverTimeMS float64) Welcome {
	return Welcome{Type: "welcome", PlayerID: playerID, Spectator: spectator, ServerTime: serverTimeMS}
}

func NewState(room RoomSnapshot) State {
	return State{Type: "state", Room: room}
}

func NewRaceText(stream string) RaceText {
	return RaceText{Type: "race_text", Stream: stream}
}

func NewPong(clientTimeMS, serverTimeMS float64) Pong {
	return Pong{Type: "pong", ClientTime: clientTimeMS, ServerTime: serverTimeMS}
}

func NewError(code ErrorCode, message string, fatal bool) Error {
	return Error{Type: "error", Code: code, Message: message, Fatal: fatal}
}
