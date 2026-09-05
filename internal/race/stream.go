package race

import (
	"math/rand/v2"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/jordan-cod/typing-race/internal/protocol"
	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
)

// StreamLength is how much text a race carries, counted in characters.
//
// The speed ceiling caps anyone at 25 characters per second, so a minute cannot consume more
// than 1500 characters however fast the player is. Building twice that means the stream is
// unreachable in practice, which is the point: the player should never see an end, because
// seeing one turns the last seconds into a different game.
const StreamLength = (protocol.RaceDurationMS / 1000) * MaxCharsPerSecond * 2

// Everything the "punctuation off" option removes.
const punctuation = `.,;:!?()"'—–`

// BuildStream builds the text for one race.
//
// Passages are shuffled and joined into continuous prose rather than picked one at a time: a
// player who reaches the end of a passage should just keep reading into the next sentence. The
// whole room gets this one string, because racing against someone typing different words is
// not a race — and for the same reason the options belong to the room, not to the player.
func BuildStream(rng *rand.Rand, opts protocol.TextOptions) string {
	var parts []string
	length := 0

	for length < StreamLength {
		for _, passage := range shuffled(rng) {
			text := ApplyOptions(passage.Text, opts)
			parts = append(parts, text)
			length += utf8.RuneCountInString(text) + 1
			if length >= StreamLength {
				break
			}
		}
	}

	return strings.Join(parts, " ")
}

// ApplyOptions strips what the options turned off.
//
// Without punctuation the text is also lower-cased: a capital letter only exists because a
// sentence started, and sentences are what the punctuation marked. Leaving the capitals would
// keep the Shift presses while removing the marks that explain them.
func ApplyOptions(text string, opts protocol.TextOptions) string {
	result := text

	if !opts.Accents {
		result = stripAccents(result)
	}

	if !opts.Punctuation {
		result = strings.Map(func(r rune) rune {
			if strings.ContainsRune(punctuation, r) {
				return -1
			}
			return r
		}, result)
		result = strings.Join(strings.Fields(result), " ")
		result = strings.ToLower(result)
	}

	return result
}

// stripAccents decomposes each letter into base plus mark so the marks can be dropped on their
// own, then recomposes. The cedilla goes with them: NFD splits "ç" into "c" plus a combining
// cedilla, which is a nonspacing mark like any accent.
func stripAccents(text string) string {
	chain := transform.Chain(
		norm.NFD,
		runes.Remove(runes.In(unicode.Mn)),
		norm.NFC,
	)
	folded, _, err := transform.String(chain, text)
	if err != nil {
		// The transformers above cannot fail on valid UTF-8, and the passages are compiled in.
		return text
	}
	return folded
}

// shuffled is Fisher-Yates over a copy, taking the source of randomness so a test can pin the
// order down.
func shuffled(rng *rand.Rand) []Passage {
	copied := make([]Passage, len(passages))
	copy(copied, passages)
	rng.Shuffle(len(copied), func(i, j int) {
		copied[i], copied[j] = copied[j], copied[i]
	})
	return copied
}
