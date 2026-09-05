// Package server puts the race rules on the network: HTTP for creating and looking up rooms,
// a WebSocket per player, and the embedded website.
package server

import (
	"context"
	"errors"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/jordan-cod/typing-race/internal/protocol"
	"github.com/jordan-cod/typing-race/internal/race"
)

// tickInterval is fast enough that a countdown and the other lanes look live, cheap enough to
// run for every room on one goroutine.
const tickInterval = 120 * time.Millisecond

// outboxSize is how many frames may be waiting on a single connection.
//
// At one state frame every 120ms this is about four seconds of backlog. A client that falls
// further behind than that is not going to catch up, so its socket is closed and it
// reconnects — which is cheaper than letting one stalled reader hold up the whole room.
const outboxSize = 32

type conn struct {
	id     string
	out    chan protocol.ServerMessage
	closed chan struct{}
	// flushed is closed by the writer once it has drained the outbox, so the socket is not
	// torn down while a frame the player needs to read is still queued.
	flushed chan struct{}
	once    sync.Once

	// Written under Hub.mu.
	roomCode string
	playerID string
}

func (c *conn) shutdown() {
	c.once.Do(func() { close(c.closed) })
}

// Hub owns every room and every open socket.
//
// race.Room and race.Registry do no locking of their own, so this one mutex is what
// serialises them. It is held only while state is being read or changed: frames go out through
// each connection's buffered channel, so a slow client is never able to stall a room from
// inside the critical section.
type Hub struct {
	mu       sync.Mutex
	registry *race.Registry
	conns    map[string]*conn
	byRoom   map[string]map[string]*conn

	nextID atomic.Uint64
	log    *slog.Logger
}

func NewHub(log *slog.Logger) *Hub {
	return &Hub{
		registry: race.NewRegistry(rand.New(rand.NewPCG(rand.Uint64(), rand.Uint64()))),
		conns:    map[string]*conn{},
		byRoom:   map[string]map[string]*conn{},
		log:      log,
	}
}

func (h *Hub) Rooms() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.registry.Size()
}

func (h *Hub) CreateRoom() string {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.registry.Create(time.Now()).Code
}

type RoomSummary struct {
	Code    string             `json:"code"`
	Phase   protocol.RacePhase `json:"phase"`
	Players int                `json:"players"`
}

func (h *Hub) RoomSummary(code string) (RoomSummary, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	room := h.registry.Get(code)
	if room == nil {
		return RoomSummary{}, false
	}
	players := 0
	for _, p := range room.Players() {
		if p.Connected {
			players++
		}
	}
	return RoomSummary{Code: room.Code, Phase: room.Phase, Players: players}, true
}

// Run drives every time-based transition from a single ticker. Scattering timeouts across
// rooms would mean one goroutine per countdown and one per race, all racing for the same lock.
func (h *Hub) Run(ctx context.Context) {
	ticker := time.NewTicker(tickInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			h.tick(now)
		}
	}
}

func (h *Hub) tick(now time.Time) {
	h.mu.Lock()

	needsBroadcast := map[string]*race.Room{}
	for _, room := range h.registry.Tick(now) {
		needsBroadcast[room.Code] = room
	}
	// While a race runs everyone needs a steady stream of the other lanes, even when no
	// message arrived from them.
	for code := range h.byRoom {
		room := h.registry.Get(code)
		if room != nil && (room.Phase == protocol.PhaseRacing || room.Phase == protocol.PhaseCountdown) {
			needsBroadcast[code] = room
		}
	}

	var pending []delivery
	for _, room := range needsBroadcast {
		pending = append(pending, h.stateFrames(room, now)...)
	}
	for _, code := range h.registry.Sweep(now) {
		delete(h.byRoom, code)
	}

	h.mu.Unlock()
	h.deliver(pending)
}

// delivery is a frame and the connection it belongs to, collected under the lock and sent
// after it is released.
type delivery struct {
	c   *conn
	msg protocol.ServerMessage
}

func (h *Hub) deliver(items []delivery) {
	for _, item := range items {
		select {
		case item.c.out <- item.msg:
		case <-item.c.closed:
		default:
			// The outbox is full: this client is too far behind to catch up.
			item.c.shutdown()
		}
	}
}

// stateFrames builds one state frame per connection in the room. Callers must hold h.mu.
func (h *Hub) stateFrames(room *race.Room, now time.Time) []delivery {
	ids := h.byRoom[room.Code]
	if len(ids) == 0 {
		return nil
	}
	msg := protocol.NewState(room.Snapshot(now))
	out := make([]delivery, 0, len(ids))
	for _, c := range ids {
		out = append(out, delivery{c: c, msg: msg})
	}
	return out
}

// textFrames sends the words to everyone in the room. Callers must hold h.mu.
func (h *Hub) textFrames(room *race.Room) []delivery {
	if room.Stream == "" {
		return nil
	}
	msg := protocol.NewRaceText(room.Stream)
	out := make([]delivery, 0, len(h.byRoom[room.Code]))
	for _, c := range h.byRoom[room.Code] {
		out = append(out, delivery{c: c, msg: msg})
	}
	return out
}

// ServeWS upgrades one request and runs the connection until it closes.
//
// A goroutine per socket is the whole point of doing this in Go: the read loop below is
// straight-line code, and the writer goroutine underneath it is what keeps one player's
// network from being felt by the rest of the room.
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	socket, err := websocket.Accept(w, r, nil)
	if err != nil {
		h.log.Debug("websocket upgrade refused", "error", err)
		return
	}

	c := &conn{
		id:      strconv.FormatUint(h.nextID.Add(1), 36),
		out:     make(chan protocol.ServerMessage, outboxSize),
		closed:  make(chan struct{}),
		flushed: make(chan struct{}),
	}

	h.mu.Lock()
	h.conns[c.id] = c
	h.mu.Unlock()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	go h.write(ctx, socket, c)
	h.read(ctx, socket, c)

	c.shutdown()
	h.leave(c)

	// A fatal error is the last thing the server says, and the reason the player is about to
	// be disconnected. Tearing the socket down without waiting would replace an explanation
	// with a blank reconnect screen.
	select {
	case <-c.flushed:
	case <-time.After(time.Second):
	}
	socket.CloseNow()
}

func (h *Hub) write(ctx context.Context, socket *websocket.Conn, c *conn) {
	defer close(c.flushed)

	send := func(msg protocol.ServerMessage) bool {
		if err := wsjson.Write(ctx, socket, msg); err != nil {
			c.shutdown()
			return false
		}
		return true
	}

	for {
		select {
		case <-ctx.Done():
			return
		case <-c.closed:
			// Drain before going: the frame explaining why the socket is closing is usually
			// already queued, and dropping it would leave the player with a bare disconnect.
			for {
				select {
				case msg := <-c.out:
					if !send(msg) {
						return
					}
				default:
					socket.Close(websocket.StatusNormalClosure, "")
					return
				}
			}
		case msg := <-c.out:
			if !send(msg) {
				return
			}
		}
	}
}

func (h *Hub) read(ctx context.Context, socket *websocket.Conn, c *conn) {
	for {
		var raw []byte
		_, raw, err := socket.Read(ctx)
		if err != nil {
			if !errors.Is(err, context.Canceled) {
				h.log.Debug("socket closed", "conn", c.id, "error", err)
			}
			return
		}

		msg, err := protocol.ParseClient(raw)
		if err != nil {
			h.send(c, protocol.NewError(protocol.ErrInvalidMessage, "Mensagem invalida", false))
			continue
		}

		pending, fatal := h.handle(c, msg, time.Now())
		h.deliver(pending)
		if fatal {
			return
		}
	}
}

func (h *Hub) send(c *conn, msg protocol.ServerMessage) {
	h.deliver([]delivery{{c: c, msg: msg}})
}
