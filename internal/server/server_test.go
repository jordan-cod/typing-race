package server

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/jordan-cod/typing-race/internal/protocol"
)

// The site the binary would normally embed. A fake one keeps the test from depending on
// whether anybody ran the frontend build.
var fakeSite = fstest.MapFS{
	"index.html":    &fstest.MapFile{Data: []byte("<!doctype html><title>Typing</title>")},
	"assets/app.js": &fstest.MapFile{Data: []byte("console.log(1)")},
}

func newTestServer(t *testing.T) (*httptest.Server, *Hub) {
	t.Helper()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := NewHub(log)

	ctx, cancel := context.WithCancel(context.Background())
	go hub.Run(ctx)

	server := httptest.NewServer(New(hub, fakeSite, log))
	t.Cleanup(func() {
		server.Close()
		cancel()
	})
	return server, hub
}

type client struct {
	t      *testing.T
	socket *websocket.Conn
	ctx    context.Context
}

func dial(t *testing.T, server *httptest.Server) *client {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)

	url := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws"
	socket, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { socket.CloseNow() })
	return &client{t: t, socket: socket, ctx: ctx}
}

func (c *client) send(msg any) {
	c.t.Helper()
	if err := wsjson.Write(c.ctx, c.socket, msg); err != nil {
		c.t.Fatalf("send: %v", err)
	}
}

// await reads until a frame of the given type arrives, so a test never breaks just because a
// state broadcast happened to land first.
func (c *client) await(wantType string) map[string]json.RawMessage {
	c.t.Helper()
	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		_, raw, err := c.socket.Read(c.ctx)
		if err != nil {
			c.t.Fatalf("waiting for %q: %v", wantType, err)
		}
		var frame map[string]json.RawMessage
		if err := json.Unmarshal(raw, &frame); err != nil {
			c.t.Fatalf("waiting for %q: %v", wantType, err)
		}
		var kind string
		json.Unmarshal(frame["type"], &kind)
		if kind == wantType {
			return frame
		}
	}
	c.t.Fatalf("no %q frame arrived", wantType)
	return nil
}

func (c *client) awaitState() protocol.RoomSnapshot {
	c.t.Helper()
	var room protocol.RoomSnapshot
	if err := json.Unmarshal(c.await("state")["room"], &room); err != nil {
		c.t.Fatalf("decoding room: %v", err)
	}
	return room
}

func createRoom(t *testing.T, server *httptest.Server) string {
	t.Helper()
	response, err := http.Post(server.URL+"/api/rooms", "", nil)
	if err != nil {
		t.Fatalf("create room: %v", err)
	}
	defer response.Body.Close()
	var body struct {
		Code string `json:"code"`
	}
	json.NewDecoder(response.Body).Decode(&body)
	if body.Code == "" {
		t.Fatal("create room returned no code")
	}
	return body.Code
}

func TestRoomEndpoints(t *testing.T) {
	server, _ := newTestServer(t)

	t.Run("a fresh room is empty and in the lobby", func(t *testing.T) {
		code := createRoom(t, server)
		response, err := http.Get(server.URL + "/api/rooms/" + code)
		if err != nil {
			t.Fatalf("get room: %v", err)
		}
		defer response.Body.Close()
		var summary RoomSummary
		json.NewDecoder(response.Body).Decode(&summary)
		if summary.Phase != protocol.PhaseLobby || summary.Players != 0 {
			t.Errorf("summary = %+v, want an empty lobby", summary)
		}
	})

	// The code is typed by hand into a form, so the difference between "you mistyped it" and
	// "that room is gone" is the difference between two very different screens.
	t.Run("a malformed code is not the same as a missing room", func(t *testing.T) {
		for path, want := range map[string]int{
			"/api/rooms/AB":   http.StatusBadRequest,
			"/api/rooms/AB0D": http.StatusBadRequest,
			"/api/rooms/ZZZZ": http.StatusNotFound,
		} {
			response, err := http.Get(server.URL + path)
			if err != nil {
				t.Fatalf("get %s: %v", path, err)
			}
			response.Body.Close()
			if response.StatusCode != want {
				t.Errorf("GET %s = %d, want %d", path, response.StatusCode, want)
			}
		}
	})
}

func TestSite(t *testing.T) {
	server, _ := newTestServer(t)

	// /r/ABCD is a real URL to whoever was sent the link; a 404 on refresh would turn sharing
	// a room into a broken page.
	t.Run("a client-side route survives a refresh", func(t *testing.T) {
		response, err := http.Get(server.URL + "/r/ABCD")
		if err != nil {
			t.Fatalf("get route: %v", err)
		}
		defer response.Body.Close()
		body, _ := io.ReadAll(response.Body)
		if response.StatusCode != http.StatusOK || !strings.Contains(string(body), "<title>Typing</title>") {
			t.Errorf("GET /r/ABCD = %d %q, want the index", response.StatusCode, body)
		}
	})

	t.Run("hashed assets are cached hard and the index is not", func(t *testing.T) {
		asset, err := http.Get(server.URL + "/assets/app.js")
		if err != nil {
			t.Fatalf("get asset: %v", err)
		}
		asset.Body.Close()
		if !strings.Contains(asset.Header.Get("Cache-Control"), "immutable") {
			t.Errorf("asset Cache-Control = %q, want immutable", asset.Header.Get("Cache-Control"))
		}

		index, err := http.Get(server.URL + "/")
		if err != nil {
			t.Fatalf("get index: %v", err)
		}
		index.Body.Close()
		if strings.Contains(index.Header.Get("Cache-Control"), "immutable") {
			// A cached index.html is a deploy that never reaches the browser.
			t.Errorf("index Cache-Control = %q, want no-cache", index.Header.Get("Cache-Control"))
		}
	})
}

func TestRaceOverTheWire(t *testing.T) {
	server, _ := newTestServer(t)
	code := createRoom(t, server)

	ana := dial(t, server)
	ana.send(protocol.Join{Type: "join", RoomCode: code, Nickname: "Ana"})
	welcome := ana.await("welcome")
	var anaID string
	json.Unmarshal(welcome["playerId"], &anaID)
	if anaID == "" {
		t.Fatal("welcome carried no player id")
	}

	bia := dial(t, server)
	bia.send(protocol.Join{Type: "join", RoomCode: code, Nickname: "Bia"})
	bia.await("welcome")

	t.Run("both players see the same room", func(t *testing.T) {
		room := bia.awaitState()
		if len(room.Players) != 2 {
			t.Fatalf("players = %d, want 2", len(room.Players))
		}
		if room.HostID == nil || *room.HostID != anaID {
			t.Errorf("host = %v, want Ana", room.HostID)
		}
	})

	t.Run("the host cannot start over someone who is not ready", func(t *testing.T) {
		ana.send(protocol.StartRace{Type: "start_race"})
		frame := ana.await("error")
		var code protocol.ErrorCode
		json.Unmarshal(frame["code"], &code)
		if code != protocol.ErrNotReady {
			t.Errorf("error code = %q, want not_ready", code)
		}
	})

	t.Run("the words arrive once everybody is ready and the host starts", func(t *testing.T) {
		bia.send(protocol.SetReady{Type: "set_ready", Ready: true})
		ana.send(protocol.StartRace{Type: "start_race"})

		var stream string
		json.Unmarshal(ana.await("race_text")["stream"], &stream)
		var biaStream string
		json.Unmarshal(bia.await("race_text")["stream"], &biaStream)

		// Racing against someone typing different words is not racing against anyone.
		if stream == "" || stream != biaStream {
			t.Error("the two players did not get the same text")
		}
	})

	t.Run("the countdown is an absolute instant on the server clock", func(t *testing.T) {
		deadline := time.Now().Add(3 * time.Second)
		for time.Now().Before(deadline) {
			room := ana.awaitState()
			if room.Phase != protocol.PhaseCountdown {
				continue
			}
			if room.StartAt == nil || room.EndsAt == nil {
				t.Fatal("countdown carries no instants")
			}
			if *room.EndsAt-*room.StartAt != protocol.RaceDurationMS {
				t.Errorf("the race is %vms long, want %d", *room.EndsAt-*room.StartAt, protocol.RaceDurationMS)
			}
			return
		}
		t.Fatal("the room never reached the countdown")
	})

	t.Run("a malformed frame is answered, not fatal", func(t *testing.T) {
		if err := ana.socket.Write(ana.ctx, websocket.MessageText, []byte(`{"type":"nope"}`)); err != nil {
			t.Fatalf("write: %v", err)
		}
		var code protocol.ErrorCode
		json.Unmarshal(ana.await("error")["code"], &code)
		if code != protocol.ErrInvalidMessage {
			t.Errorf("error code = %q, want invalid_message", code)
		}
		// Still usable afterwards.
		ana.send(protocol.Ping{Type: "ping", ClientTime: 123})
		var echoed float64
		json.Unmarshal(ana.await("pong")["clientTime"], &echoed)
		if echoed != 123 {
			t.Errorf("pong echoed %v, want 123", echoed)
		}
	})

	t.Run("a player who drops is still shown, holding their place", func(t *testing.T) {
		bia.socket.CloseNow()
		deadline := time.Now().Add(3 * time.Second)
		for time.Now().Before(deadline) {
			room := ana.awaitState()
			for _, p := range room.Players {
				if p.Nickname == "Bia" && !p.Connected {
					return
				}
			}
		}
		t.Fatal("Ana was never told that Bia dropped")
	})
}

func TestJoiningARoomThatIsGone(t *testing.T) {
	server, _ := newTestServer(t)

	c := dial(t, server)
	c.send(protocol.Join{Type: "join", RoomCode: "ZZZZ", Nickname: "Ana"})

	frame := c.await("error")
	var code protocol.ErrorCode
	var fatal bool
	json.Unmarshal(frame["code"], &code)
	json.Unmarshal(frame["fatal"], &fatal)
	if code != protocol.ErrRoomNotFound || !fatal {
		t.Errorf("error = %q fatal=%v, want room_not_found fatal", code, fatal)
	}

	// Fatal means the server is closing the socket; the player has to be told why before it
	// goes away, or all they see is a disconnect.
	if _, _, err := c.socket.Read(c.ctx); err == nil {
		t.Error("the socket stayed open after a fatal error")
	}
}
