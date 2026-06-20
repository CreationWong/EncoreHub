// EncoreHub API Gateway
//
// Go service responsible for:
// - HTTP/SSE entrypoint for the frontend
// - Multi-provider AI API adapter (OpenAI, Anthropic, Gemini, etc.)
// - Protocol translation (unified format <-> provider-specific)
// - SSE streaming proxy
// - Proxies conversation CRUD to Rust engine

package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/encorehub/gateway/internal/engine"
	"github.com/encorehub/gateway/internal/handler"
	"github.com/encorehub/gateway/internal/provider"
	"github.com/encorehub/gateway/internal/router"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

const shutdownTimeout = 5 * time.Second

func main() {
	// Setup structured logging
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})

	log.Info().Msg("EncoreHub Gateway starting...")

	// Configuration from environment
	engineURL := os.Getenv("ENGINE_URL")
	if engineURL == "" {
		engineURL = "http://127.0.0.1:3000"
	}

	listenAddr := os.Getenv("LISTEN_ADDR")
	if listenAddr == "" {
		listenAddr = ":8080"
	}

	// Provider registry starts empty; the ProfileStore populates it from
	// persisted profiles (or builtin defaults) during Load below.
	registry := provider.NewRegistry()

	// Initialize engine client
	engineClient := engine.NewClient(engineURL)

	// Health check against engine. The engine and gateway are spawned together
	// by the desktop app, so the engine may still be booting — retry briefly
	// before warning. A non-nil context is required (http.NewRequestWithContext
	// rejects a nil context outright).
	engineReady := false
	for attempt := 0; attempt < 10; attempt++ {
		ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
		err := engineClient.Health(ctx)
		cancel()
		if err == nil {
			engineReady = true
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
	if engineReady {
		log.Info().Str("engine_url", engineURL).Msg("engine connected")
	} else {
		log.Warn().Str("engine_url", engineURL).
			Msg("engine not reachable after retries — conversation features may fail until it starts")
	}

	// Apply the persisted log level (from the engine's config) to the gateway.
	handler.ApplyInitialLevel(engineClient)

	// Load provider profiles into the registry. On engine failure this falls
	// back to builtin defaults so chat still works against the default set.
	profileStore := handler.NewProfileStore(engineClient, registry)
	if err := profileStore.Load(context.Background()); err != nil {
		log.Warn().Err(err).Msg("provider profiles loaded with fallback/partial errors")
	}
	log.Info().
		Strs("providers", registry.List()).
		Msg("registered providers")

	// Setup router
	r := router.Setup(router.Config{
		Registry:     registry,
		Engine:       engineClient,
		ProfileStore: profileStore,
	})

	// Wrap gin in *http.Server so we can call Shutdown(ctx).
	srv := &http.Server{
		Addr:              listenAddr,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}

	serveErr := make(chan error, 1)
	go func() {
		log.Info().Str("addr", listenAddr).Msg("Gateway listening")
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErr <- err
		}
		close(serveErr)
	}()

	// Wait for shutdown signal or fatal listen error.
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	select {
	case sig := <-quit:
		log.Info().Str("signal", sig.String()).Msg("shutdown requested")
	case err := <-serveErr:
		if err != nil {
			log.Fatal().Err(err).Msg("server failed")
		}
		return
	}

	// Drain in-flight requests with a bounded timeout.
	ctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Warn().Err(err).Msg("graceful shutdown timed out")
	} else {
		log.Info().Msg("Gateway stopped cleanly")
	}
}
