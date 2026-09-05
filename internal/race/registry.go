package race

import (
	"math/rand/v2"
	"time"

	"github.com/jordan-cod/typing-race/internal/protocol"
)

// EmptyRoomTTL is how long a room nobody ever joined survives, so abandoned codes do not pile
// up in memory.
const EmptyRoomTTL = 2 * time.Minute

// Registry is the in-memory room store. Rooms are ephemeral by design: there is no database,
// and a room stops existing as soon as the last player disconnects.
//
// Like Room, it assumes a single owner goroutine and does no locking of its own.
type Registry struct {
	rooms     map[string]*Room
	createdAt map[string]time.Time
	rng       *rand.Rand
}

func NewRegistry(rng *rand.Rand) *Registry {
	return &Registry{
		rooms:     map[string]*Room{},
		createdAt: map[string]time.Time{},
		rng:       rng,
	}
}

func (reg *Registry) Size() int { return len(reg.rooms) }

func (reg *Registry) GenerateCode() string {
	code := make([]byte, protocol.RoomCodeLength)
	for i := range code {
		code[i] = protocol.RoomCodeAlphabet[reg.rng.IntN(len(protocol.RoomCodeAlphabet))]
	}
	return string(code)
}

func (reg *Registry) Create(now time.Time) *Room {
	code := reg.GenerateCode()
	for _, taken := reg.rooms[code]; taken; _, taken = reg.rooms[code] {
		code = reg.GenerateCode()
	}
	room := NewRoom(code, reg.rng)
	reg.rooms[code] = room
	reg.createdAt[code] = now
	return room
}

func (reg *Registry) Get(code string) *Room { return reg.rooms[code] }

func (reg *Registry) Delete(code string) {
	delete(reg.rooms, code)
	delete(reg.createdAt, code)
}

// Tick advances every room's clock and returns the ones whose state changed.
func (reg *Registry) Tick(now time.Time) []*Room {
	var changed []*Room
	for _, room := range reg.rooms {
		if room.Tick(now) {
			changed = append(changed, room)
		}
	}
	return changed
}

// Sweep drops rooms that emptied out and codes that were created but never used.
func (reg *Registry) Sweep(now time.Time) []string {
	var removed []string
	for code, room := range reg.rooms {
		created, ok := reg.createdAt[code]
		if !ok {
			created = now
		}
		expiredUnused := !room.EverJoined && now.Sub(created) > EmptyRoomTTL
		if expiredUnused || (room.EverJoined && room.Abandoned()) {
			reg.Delete(code)
			removed = append(removed, code)
		}
	}
	return removed
}

// Rooms returns every live room. The order is the map's, so callers must not depend on it.
func (reg *Registry) Rooms() []*Room {
	out := make([]*Room, 0, len(reg.rooms))
	for _, room := range reg.rooms {
		out = append(out, room)
	}
	return out
}
