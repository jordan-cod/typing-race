// Command typing serves the game: the race rules, the WebSocket, and the website itself.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jordan-cod/typing-race/internal/server"
	"github.com/jordan-cod/typing-race/web"
)

func main() {
	// The container image is `scratch`: no shell, no curl, no wget. Rather than pull a whole
	// userland in just so Docker can ask whether the server is up, the binary answers that
	// question about itself.
	healthcheck := flag.Bool("healthcheck", false, "probe a running server and exit")
	flag.Parse()
	if *healthcheck {
		os.Exit(probe())
	}

	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: logLevel()}))

	// The context dies on SIGINT/SIGTERM, which is how Docker asks a container to stop. Every
	// goroutine below hangs off it, so a `docker compose down` ends the process instead of
	// waiting out the ten-second kill timer.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	hub := server.NewHub(log)
	go hub.Run(ctx)

	addr := ":" + env("PORT", "3001")
	httpServer := &http.Server{
		Addr:    addr,
		Handler: server.New(hub, web.Site(), log),
		// No write or read deadline: a WebSocket is meant to stay open for the whole race, and
		// a server-wide timeout would cut it mid-minute. The header timeout still covers the
		// one thing a deadline is for here, a connection that opens and then says nothing.
		ReadHeaderTimeout: 10 * time.Second,
		BaseContext:       func(net.Listener) context.Context { return ctx },
	}

	go func() {
		log.Info("listening", "addr", addr)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("server stopped", "error", err)
			stop()
		}
	}()

	<-ctx.Done()
	log.Info("shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		log.Error("shutdown", "error", err)
	}
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func logLevel() slog.Level {
	if os.Getenv("DEBUG") != "" {
		return slog.LevelDebug
	}
	return slog.LevelInfo
}

// probe is the container healthcheck. /health counts the live rooms, so a zero exit means the
// registry answered — not merely that a process is running.
func probe() int {
	client := http.Client{Timeout: 3 * time.Second}
	response, err := client.Get("http://127.0.0.1:" + env("PORT", "3001") + "/health")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		fmt.Fprintln(os.Stderr, response.Status)
		return 1
	}
	return 0
}
