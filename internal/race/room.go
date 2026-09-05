package race

import (
	"fmt"
	"math/rand/v2"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jordan-cod/typing-race/internal/protocol"
)

// LateReportGrace is how long after the minute is up a progress report is still counted.
//
// The last keystrokes of a race and the frame carrying them are separated by the network. A
// player who typed a character at 59.98s deserves it, and refusing anything that lands after
// the bell would quietly punish whoever has the worse connection. The report is still measured
// against a 60-second budget, so the window buys latency, not typing time.
const LateReportGrace = time.Second

const raceDuration = protocol.RaceDurationMS * time.Millisecond
const countdown = protocol.CountdownMS * time.Millisecond

// Failure is a refused command, carrying the code the client switches on and the line the
// player reads. A nil *Failure means the command was accepted.
type Failure struct {
	Code    protocol.ErrorCode
	Message string
}

func (f *Failure) Error() string { return f.Message }

func fail(code protocol.ErrorCode, message string) *Failure {
	return &Failure{Code: code, Message: message}
}

type Player struct {
	ID       string
	Nickname string
	Ready    bool
	// Connected goes false instead of the player being removed mid-race, so the others keep
	// seeing the lane and the player keeps their place in the final ranking.
	Connected bool
	// Spectator joined after the start; they watch and are left out of the ranking.
	Spectator    bool
	CorrectChars int
	Errors       int
}

// Room is a single room and the whole race state machine.
//
// It is deliberately not safe for concurrent use: the clock arrives as an argument, there is
// no I/O, no socket and no timer, and the one goroutine that owns the room serialises every
// call. That is what keeps the race rules unit-testable.
//
// Players live in a slice rather than a map because the order they joined in is the order the
// lanes are drawn in, and because eight is small enough that a scan is the cheaper lookup.
type Room struct {
	Code        string
	Phase       protocol.RacePhase
	HostID      string
	TextOptions protocol.TextOptions
	Stream      string
	// streamLength is the stream measured in characters, which is the unit the browser counts
	// progress in. Go would otherwise measure bytes and let an accented text be typed past its
	// own end.
	streamLength int
	StartAt      time.Time
	EndedAt      time.Time
	// EverJoined keeps a freshly created code from being swept as abandoned before anyone has
	// had the chance to use it.
	EverJoined bool

	players []*Player
	rng     *rand.Rand
}

func NewRoom(code string, rng *rand.Rand) *Room {
	return &Room{
		Code:        code,
		Phase:       protocol.PhaseLobby,
		TextOptions: protocol.DefaultTextOptions,
		players:     make([]*Player, 0, protocol.MaxPlayersPerRoom),
		rng:         rng,
	}
}

func (r *Room) Players() []*Player { return r.players }

func (r *Room) Player(id string) *Player {
	for _, p := range r.players {
		if p.ID == id {
			return p
		}
	}
	return nil
}

// EndsAt is the absolute instant the minute is up. The client renders its clock from this, not
// from a duration.
func (r *Room) EndsAt() time.Time {
	if r.StartAt.IsZero() {
		return time.Time{}
	}
	return r.StartAt.Add(raceDuration)
}

// Abandoned means there is nobody left to broadcast to; the registry drops the room.
func (r *Room) Abandoned() bool {
	for _, p := range r.players {
		if p.Connected {
			return false
		}
	}
	return true
}

func (r *Room) racers() []*Player {
	out := make([]*Player, 0, len(r.players))
	for _, p := range r.players {
		if !p.Spectator {
			out = append(out, p)
		}
	}
	return out
}

func (r *Room) Join(id, nickname string) (*Player, *Failure) {
	connected := 0
	for _, p := range r.players {
		if p.Connected {
			connected++
		}
	}
	if connected >= protocol.MaxPlayersPerRoom {
		return nil, fail(protocol.ErrRoomFull, "Sala cheia")
	}
	for _, p := range r.players {
		if p.Connected && strings.EqualFold(p.Nickname, nickname) {
			return nil, fail(protocol.ErrNicknameTaken, "Esse apelido ja esta em uso na sala")
		}
	}

	// Coming back with the same nickname reconnects instead of joining again. Without this,
	// whoever drops mid-race reappears as a second player and leaves their own lane orphaned
	// on everyone else's screen, with the progress they had made stuck in it.
	for _, p := range r.players {
		if !p.Connected && strings.EqualFold(p.Nickname, nickname) {
			wasHost := r.HostID == p.ID
			p.ID = id
			p.Connected = true
			if wasHost {
				r.HostID = id
			}
			return p, nil
		}
	}

	// A race already under way is joined as a spectator: dropping someone into a minute the
	// others started 40 seconds ago would only produce a rigged ranking.
	spectator := r.Phase != protocol.PhaseLobby
	player := &Player{ID: id, Nickname: nickname, Connected: true, Spectator: spectator}
	r.players = append(r.players, player)
	r.EverJoined = true
	if r.HostID == "" && !spectator {
		r.HostID = id
	}
	return player, nil
}

func (r *Room) Leave(id string) {
	for i, p := range r.players {
		if p.ID != id {
			continue
		}
		if r.Phase == protocol.PhaseLobby || r.Phase == protocol.PhaseFinished || p.Spectator {
			r.players = append(r.players[:i], r.players[i+1:]...)
		} else {
			p.Connected = false
			p.Ready = false
		}
		break
	}
	if r.HostID == id {
		r.HostID = r.nextHostID()
	}
}

func (r *Room) nextHostID() string {
	for _, p := range r.players {
		if p.Connected && !p.Spectator {
			return p.ID
		}
	}
	for _, p := range r.players {
		if p.Connected {
			return p.ID
		}
	}
	return ""
}

func (r *Room) SetTextOptions(id string, options protocol.TextOptions) *Failure {
	if r.HostID != id {
		return fail(protocol.ErrNotHost, "So quem criou a sala pode mudar o texto")
	}
	if r.Phase != protocol.PhaseLobby {
		return fail(protocol.ErrWrongPhase, "A corrida ja comecou")
	}
	r.TextOptions = options
	return nil
}

func (r *Room) SetReady(id string, ready bool) *Failure {
	player := r.Player(id)
	if player == nil {
		return fail(protocol.ErrNotJoined, "Voce nao esta na sala")
	}
	if r.Phase != protocol.PhaseLobby {
		return fail(protocol.ErrWrongPhase, "A corrida ja comecou")
	}
	if player.Spectator {
		return fail(protocol.ErrWrongPhase, "Voce esta assistindo")
	}
	player.Ready = ready
	return nil
}

func (r *Room) Start(id string, now time.Time, solo bool) *Failure {
	if r.HostID != id {
		return fail(protocol.ErrNotHost, "So quem criou a sala pode comecar")
	}
	if r.Phase != protocol.PhaseLobby {
		return fail(protocol.ErrWrongPhase, "A corrida ja comecou")
	}

	var racers []*Player
	for _, p := range r.racers() {
		if p.Connected {
			racers = append(racers, p)
		}
	}
	if len(racers) == 0 {
		return fail(protocol.ErrNotEnoughPlayers, "Ninguem na sala")
	}
	if len(racers) == 1 && !solo {
		return fail(protocol.ErrNotEnoughPlayers, "Chame mais alguem para correr")
	}

	// The host does not tick "ready": starting the race is their ready. Everyone else has to
	// have said they are, or the start happens on top of someone still settling their hands on
	// the keyboard — and in a timed minute that decides the race.
	var waiting []string
	for _, p := range racers {
		if p.ID != id && !p.Ready {
			waiting = append(waiting, p.Nickname)
		}
	}
	if len(waiting) == 1 {
		return fail(protocol.ErrNotReady, fmt.Sprintf("%s ainda nao esta pronto", waiting[0]))
	}
	if len(waiting) > 1 {
		return fail(protocol.ErrNotReady, "Ainda nao estao prontos: "+strings.Join(waiting, ", "))
	}

	// Built once, here, and handed to everyone: the room races the same words or it is not a
	// race.
	r.Stream = BuildStream(r.rng, r.TextOptions)
	r.streamLength = utf8.RuneCountInString(r.Stream)
	r.Phase = protocol.PhaseCountdown
	r.StartAt = now.Add(countdown)
	r.EndedAt = time.Time{}
	for _, p := range r.racers() {
		p.CorrectChars = 0
		p.Errors = 0
	}
	return nil
}

// ApplyProgress records progress reported by a client.
//
// The numbers are only ever accepted as a claim: the elapsed time is the server's, and a
// report that would need superhuman speed (a paste, most of the time) is dropped without
// touching the stored progress, so a client cannot climb the ranking by lying.
func (r *Room) ApplyProgress(id string, correctChars, errors int, now time.Time) *Failure {
	player := r.Player(id)
	if player == nil {
		return fail(protocol.ErrNotJoined, "Voce nao esta na sala")
	}
	if r.StartAt.IsZero() || r.Stream == "" || !r.acceptsProgressAt(now) {
		return fail(protocol.ErrWrongPhase, "A corrida nao esta em andamento")
	}
	if player.Spectator {
		return fail(protocol.ErrWrongPhase, "Voce esta assistindo")
	}

	// Capped at the race duration so a report that arrives after the bell is measured against
	// the minute the player actually had, not against the extra latency.
	elapsed := now.Sub(r.StartAt)
	if elapsed > raceDuration {
		elapsed = raceDuration
	}
	rejection := CheckProgress(ProgressCandidate{
		PreviousChars:  player.CorrectChars,
		NextChars:      correctChars,
		PreviousErrors: player.Errors,
		NextErrors:     errors,
		StreamLength:   r.streamLength,
		ElapsedMS:      elapsed.Milliseconds(),
	})
	if rejection != "" {
		return fail(protocol.ErrProgressRejected, rejection.Message())
	}

	player.CorrectChars = correctChars
	player.Errors = errors
	return nil
}

func (r *Room) acceptsProgressAt(now time.Time) bool {
	if r.Phase == protocol.PhaseRacing {
		return true
	}
	if r.Phase != protocol.PhaseFinished || r.EndedAt.IsZero() {
		return false
	}
	return now.Sub(r.EndedAt) <= LateReportGrace
}

// Tick advances anything that depends only on the clock, and reports whether the phase changed
// and the room needs a broadcast. Keeping every time-based transition behind one call is what
// lets a single server ticker drive every room instead of scattered timers.
func (r *Room) Tick(now time.Time) bool {
	if r.Phase == protocol.PhaseCountdown && !r.StartAt.IsZero() && !now.Before(r.StartAt) {
		r.Phase = protocol.PhaseRacing
		return true
	}
	if r.Phase == protocol.PhaseRacing && !r.StartAt.IsZero() {
		endsAt := r.EndsAt()
		if !now.Before(endsAt) {
			r.Phase = protocol.PhaseFinished
			// The scheduled instant, not `now`: stats are divided by this, and a tick that
			// fires 40ms late must not make everyone's WPM slightly worse.
			r.EndedAt = endsAt
			return true
		}
		// A room where everyone dropped ends immediately instead of running a minute for
		// nobody.
		for _, p := range r.racers() {
			if p.Connected {
				return false
			}
		}
		r.Phase = protocol.PhaseFinished
		r.EndedAt = now
		return true
	}
	return false
}

func (r *Room) PlayAgain(id string) *Failure {
	if r.HostID != id {
		return fail(protocol.ErrNotHost, "So quem criou a sala pode reiniciar")
	}
	if r.Phase != protocol.PhaseFinished {
		return fail(protocol.ErrWrongPhase, "A corrida ainda nao terminou")
	}

	kept := r.players[:0]
	for _, p := range r.players {
		if !p.Connected {
			continue
		}
		p.Ready = false
		// Whoever watched the last race is a full racer in the next one.
		p.Spectator = false
		p.CorrectChars = 0
		p.Errors = 0
		kept = append(kept, p)
	}
	r.players = kept

	r.Phase = protocol.PhaseLobby
	r.Stream = ""
	r.streamLength = 0
	r.StartAt = time.Time{}
	r.EndedAt = time.Time{}
	if r.Player(r.HostID) == nil {
		r.HostID = r.nextHostID()
	}
	return nil
}

func (r *Room) Snapshot(now time.Time) protocol.RoomSnapshot {
	elapsed := r.elapsedAt(now)

	// Ranked live, not only at the end: a player needs to see the moment they are passed.
	rankByID := map[string]int{}
	if r.Phase == protocol.PhaseRacing || r.Phase == protocol.PhaseFinished {
		racers := r.racers()
		entries := make([]Entry, 0, len(racers))
		for _, p := range racers {
			entries = append(entries, Entry{
				PlayerID:     p.ID,
				Nickname:     p.Nickname,
				CorrectChars: p.CorrectChars,
				Errors:       p.Errors,
				Connected:    p.Connected,
			})
		}
		for _, ranked := range Rank(entries, elapsed.Milliseconds()) {
			rankByID[ranked.PlayerID] = ranked.Rank
		}
	}

	players := make([]protocol.PlayerSnapshot, 0, len(r.players))
	for _, p := range r.players {
		var rank *int
		if !p.Spectator {
			if value, ok := rankByID[p.ID]; ok {
				rank = &value
			}
		}
		players = append(players, protocol.PlayerSnapshot{
			ID:           p.ID,
			Nickname:     p.Nickname,
			IsHost:       p.ID == r.HostID,
			Ready:        p.Ready,
			Connected:    p.Connected,
			Spectator:    p.Spectator,
			CorrectChars: p.CorrectChars,
			Errors:       p.Errors,
			WPM:          WPM(p.CorrectChars, elapsed.Milliseconds()),
			Accuracy:     Accuracy(p.CorrectChars, p.Errors),
			Rank:         rank,
		})
	}

	return protocol.RoomSnapshot{
		Code:        r.Code,
		Phase:       r.Phase,
		HostID:      nilIfEmpty(r.HostID),
		StartAt:     epochMS(r.StartAt),
		EndsAt:      epochMS(r.EndsAt()),
		EndedAt:     epochMS(r.EndedAt),
		Players:     players,
		TextOptions: r.TextOptions,
		ServerTime:  float64(now.UnixMilli()),
	}
}

func (r *Room) elapsedAt(now time.Time) time.Duration {
	if r.StartAt.IsZero() {
		return 0
	}
	until := now
	if !r.EndedAt.IsZero() {
		until = r.EndedAt
	}
	elapsed := until.Sub(r.StartAt)
	if elapsed < 0 {
		return 0
	}
	if elapsed > raceDuration {
		return raceDuration
	}
	return elapsed
}

// The wire uses null for "no instant yet", which is what the client renders its clock from.
func epochMS(t time.Time) *float64 {
	if t.IsZero() {
		return nil
	}
	ms := float64(t.UnixMilli())
	return &ms
}

func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
