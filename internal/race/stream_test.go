package race

import (
	"math/rand/v2"
	"regexp"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/jordan-cod/typing-race/internal/protocol"
)

// seeded gives every test the same shuffle, the way the TypeScript suite passed a constant
// random function.
func seeded() *rand.Rand { return rand.New(rand.NewPCG(42, 42)) }

func TestBuildStream(t *testing.T) {
	t.Run("carries more text than the fastest possible minute", func(t *testing.T) {
		stream := BuildStream(seeded(), protocol.DefaultTextOptions)
		fastestPossible := (protocol.RaceDurationMS / 1000) * MaxCharsPerSecond
		length := utf8.RuneCountInString(stream)
		if length < StreamLength {
			t.Errorf("stream is %d characters, want at least %d", length, StreamLength)
		}
		if length <= fastestPossible {
			t.Errorf("stream is %d characters, the fastest minute is %d", length, fastestPossible)
		}
	})

	t.Run("is continuous prose, not a list", func(t *testing.T) {
		stream := BuildStream(seeded(), protocol.DefaultTextOptions)
		if strings.Contains(stream, "\n") {
			t.Error("stream contains a line break")
		}
		if strings.TrimSpace(stream) != stream {
			t.Error("stream is padded with whitespace")
		}
	})

	t.Run("is the same for everyone when the room builds it once", func(t *testing.T) {
		// The room builds one stream and hands the same string to every player; two builds from
		// the same source of randomness must agree, or a replay would not be reproducible.
		if BuildStream(seeded(), protocol.DefaultTextOptions) != BuildStream(seeded(), protocol.DefaultTextOptions) {
			t.Error("two builds from the same seed disagree")
		}
	})

	t.Run("reuses the passages it has instead of inventing text", func(t *testing.T) {
		stream := BuildStream(seeded(), protocol.DefaultTextOptions)
		if !strings.Contains(stream, passages[0].Text) {
			t.Errorf("stream does not contain the first passage")
		}
	})

	// The browser counts progress in UTF-16 code units and the server counts runes. The two
	// agree only while no character needs a surrogate pair, so an emoji added to a passage
	// would silently let a player type past the end of their own stream.
	t.Run("every passage stays inside the basic plane", func(t *testing.T) {
		for _, passage := range passages {
			for _, r := range passage.Text {
				if r > 0xFFFF {
					t.Errorf("passage %q contains %q, which the browser counts as two characters",
						passage.ID, r)
				}
			}
		}
	})
}

func TestApplyOptions(t *testing.T) {
	const phrase = "O café da manhã estava frio, mas ninguém reclamou!"

	cases := []struct {
		name string
		opts protocol.TextOptions
		want string
	}{
		{
			"sem acento, as letras continuam as mesmas",
			protocol.TextOptions{Accents: false, Punctuation: true},
			"O cafe da manha estava frio, mas ninguem reclamou!",
		},
		{
			// A maiúscula existe porque uma frase começou, e a frase é o que a pontuação
			// marcava. Manter as maiúsculas sem a pontuação deixaria o Shift sem motivo.
			"sem pontuação, o texto também perde as maiúsculas",
			protocol.TextOptions{Accents: true, Punctuation: false},
			"o café da manhã estava frio mas ninguém reclamou",
		},
		{
			"sem os dois, sobra só letra e espaço",
			protocol.TextOptions{Accents: false, Punctuation: false},
			"o cafe da manha estava frio mas ninguem reclamou",
		},
		{
			"o padrão não mexe em nada",
			protocol.DefaultTextOptions,
			phrase,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := ApplyOptions(phrase, c.opts); got != c.want {
				t.Errorf("ApplyOptions() = %q, want %q", got, c.want)
			}
		})
	}

	// Tirar pontuação deixa espaços duplos onde a vírgula estava colada.
	t.Run("não sobra espaço dobrado onde a pontuação saiu", func(t *testing.T) {
		got := ApplyOptions("a, b. c", protocol.TextOptions{Accents: true, Punctuation: false})
		if got != "a b c" {
			t.Errorf("ApplyOptions() = %q, want %q", got, "a b c")
		}
	})
}

func TestStreamHonoursTheOptions(t *testing.T) {
	t.Run("a corrida inteira respeita a escolha", func(t *testing.T) {
		stream := BuildStream(seeded(), protocol.TextOptions{})
		if regexp.MustCompile(`[áéíóúãõçâêô.,;:!?]`).MatchString(stream) {
			t.Error("stream still carries accents or punctuation")
		}
	})

	// O texto-fonte é português correto; sem isso não existe modo "com acento".
	t.Run("o padrão traz acento de verdade", func(t *testing.T) {
		stream := BuildStream(seeded(), protocol.DefaultTextOptions)
		if !regexp.MustCompile(`[áéíóúãõç]`).MatchString(stream) {
			t.Error("default stream has no accents at all")
		}
	})
}
