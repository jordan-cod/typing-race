package server

import (
	"time"

	"github.com/jordan-cod/typing-race/internal/protocol"
	"github.com/jordan-cod/typing-race/internal/race"
)

// handle applies one client frame and returns the frames it produced, plus whether the socket
// should be closed afterwards.
//
// Everything that touches room state happens under the lock; nothing is written to a socket
// while it is held.
func (h *Hub) handle(c *conn, msg protocol.ClientMessage, now time.Time) (pending []delivery, fatal bool) {
	// Ping never touches a room, so it never waits on the lock. A countdown is an absolute
	// server instant and the client corrects its clock from these replies: making them queue
	// behind a broadcast would bias the very measurement they exist to take.
	if ping, ok := msg.(protocol.Ping); ok {
		return []delivery{{c: c, msg: protocol.NewPong(ping.ClientTime, float64(now.UnixMilli()))}}, false
	}

	h.mu.Lock()
	defer h.mu.Unlock()

	if join, ok := msg.(protocol.Join); ok {
		return h.handleJoin(c, join, now)
	}

	if c.roomCode == "" || c.playerID == "" {
		return h.one(c, protocol.NewError(protocol.ErrNotJoined, "Entre em uma sala primeiro", false)), false
	}
	room := h.registry.Get(c.roomCode)
	if room == nil {
		return h.one(c, protocol.NewError(protocol.ErrRoomNotFound, "A sala nao existe mais", true)), true
	}

	var failure *race.Failure
	started := false

	switch m := msg.(type) {
	case protocol.SetReady:
		failure = room.SetReady(c.playerID, m.Ready)
	case protocol.SetTextOptions:
		failure = room.SetTextOptions(c.playerID, protocol.TextOptions{
			Accents:     m.Accents,
			Punctuation: m.Punctuation,
		})
	case protocol.StartRace:
		failure = room.Start(c.playerID, now, m.Solo)
		started = failure == nil
	case protocol.Progress:
		failure = room.ApplyProgress(c.playerID, m.CorrectChars, m.Errors, now)
	case protocol.PlayAgain:
		failure = room.PlayAgain(c.playerID)
	}

	if failure != nil {
		pending = h.one(c, protocol.NewError(failure.Code, failure.Message, false))
		// A rejected progress report still gets a snapshot back, so a client that lied is
		// snapped back to the progress the server actually believes.
		if failure.Code == protocol.ErrProgressRejected {
			pending = append(pending, delivery{c: c, msg: protocol.NewState(room.Snapshot(now))})
		}
		return pending, false
	}

	if started {
		pending = append(pending, h.textFrames(room)...)
	}
	return append(pending, h.stateFrames(room, now)...), false
}

func (h *Hub) handleJoin(c *conn, msg protocol.Join, now time.Time) ([]delivery, bool) {
	// A second join on the same socket is ignored rather than refused: it can only come from a
	// client bug, and answering it would let one socket own two lanes.
	if c.playerID != "" {
		return nil, false
	}

	room := h.registry.Get(msg.RoomCode)
	if room == nil {
		return h.one(c, protocol.NewError(protocol.ErrRoomNotFound, "Sala nao encontrada", true)), true
	}

	player, failure := room.Join(c.id, msg.Nickname)
	if failure != nil {
		return h.one(c, protocol.NewError(failure.Code, failure.Message, true)), true
	}

	c.roomCode = room.Code
	c.playerID = player.ID
	if h.byRoom[room.Code] == nil {
		h.byRoom[room.Code] = map[string]*conn{}
	}
	h.byRoom[room.Code][c.id] = c

	pending := h.one(c, protocol.NewWelcome(player.ID, player.Spectator, float64(now.UnixMilli())))
	// Before the snapshot: a spectator dropped into a running race needs the words in hand by
	// the time they are told a race is running.
	if room.Stream != "" {
		pending = append(pending, delivery{c: c, msg: protocol.NewRaceText(room.Stream)})
	}
	return append(pending, h.stateFrames(room, now)...), false
}

// leave detaches a closed socket and tells the rest of the room.
func (h *Hub) leave(c *conn) {
	h.mu.Lock()

	delete(h.conns, c.id)
	if c.roomCode == "" {
		h.mu.Unlock()
		return
	}

	if sockets := h.byRoom[c.roomCode]; sockets != nil {
		delete(sockets, c.id)
		if len(sockets) == 0 {
			delete(h.byRoom, c.roomCode)
		}
	}

	room := h.registry.Get(c.roomCode)
	if room == nil {
		h.mu.Unlock()
		return
	}
	if c.playerID != "" {
		room.Leave(c.playerID)
	}
	if room.Abandoned() || len(room.Players()) == 0 {
		h.registry.Delete(room.Code)
		h.mu.Unlock()
		return
	}

	pending := h.stateFrames(room, time.Now())
	h.mu.Unlock()
	h.deliver(pending)
}

func (h *Hub) one(c *conn, msg protocol.ServerMessage) []delivery {
	return []delivery{{c: c, msg: msg}}
}
