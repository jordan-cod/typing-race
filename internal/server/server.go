package server

import (
	"encoding/json"
	"io/fs"
	"log/slog"
	"net/http"
	"path"
	"strings"

	"github.com/jordan-cod/typing-race/internal/protocol"
)

// New wires the routes.
//
// The site is served by this same binary from an embedded filesystem, so there is one artefact
// to build, one image to ship and one origin in the browser. Same origin is why there is no
// CORS middleware here and no API URL baked into the bundle: the page talks to wherever it
// came from.
func New(hub *Hub, site fs.FS, log *slog.Logger) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "rooms": hub.Rooms()})
	})

	mux.HandleFunc("POST /api/rooms", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"code": hub.CreateRoom()})
	})

	mux.HandleFunc("GET /api/rooms/{code}", func(w http.ResponseWriter, r *http.Request) {
		code, err := protocol.NormalizeRoomCode(r.PathValue("code"))
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_code"})
			return
		}
		summary, ok := hub.RoomSummary(code)
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "room_not_found"})
			return
		}
		writeJSON(w, http.StatusOK, summary)
	})

	mux.HandleFunc("GET /ws", hub.ServeWS)

	mux.Handle("/", spa(site, log))

	return mux
}

// spa serves the built site, falling back to index.html for anything that is not a file.
//
// The fallback is what makes a client-side route survive a refresh: /r/ABCD is a real URL to
// the player, and a 404 there would turn sharing a room link into a broken page.
func spa(site fs.FS, log *slog.Logger) http.Handler {
	files := http.FileServerFS(site)

	index, err := fs.ReadFile(site, "index.html")
	if err != nil {
		log.Warn("no built site embedded; only the API will answer", "error", err)
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if name != "" {
			if _, err := fs.Stat(site, name); err == nil {
				// Everything under /assets carries a content hash in its name, so it can be
				// cached hard. index.html deliberately is not, or a deploy would never reach
				// a browser that already has the old one.
				if strings.HasPrefix(name, "assets/") {
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				}
				files.ServeHTTP(w, r)
				return
			}
		}

		if index == nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		w.Write(index)
	})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(body)
}
