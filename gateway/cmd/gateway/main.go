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
	"os"
	"os/signal"
	"syscall"

	"github.com/encorehub/gateway/internal/engine"
	"github.com/encorehub/gateway/internal/provider"
	"github.com/encorehub/gateway/internal/provider/anthropic"
	"github.com/encorehub/gateway/internal/provider/deepseek"
	"github.com/encorehub/gateway/internal/provider/openai"
	"github.com/encorehub/gateway/internal/router"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

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

	// Initialize provider registry
	registry := provider.NewRegistry(
		openai.New(),
		anthropic.New(),
		deepseek.New(),
	)

	log.Info().
		Strs("providers", registry.List()).
		Msg("registered providers")

	// Initialize engine client
	engineClient := engine.NewClient(engineURL)

	// Health check against engine
	if err := engineClient.Health(nil); err != nil {
		log.Warn().Err(err).Str("engine_url", engineURL).
			Msg("engine not reachable — conversation features will fail")
	} else {
		log.Info().Str("engine_url", engineURL).Msg("engine connected")
	}

	// Setup router
	r := router.Setup(router.Config{
		Registry: registry,
		Engine:   engineClient,
	})

	// Start server in background
	go func() {
		log.Info().Str("addr", listenAddr).Msg("Gateway listening")
		if err := r.Run(listenAddr); err != nil {
			log.Fatal().Err(err).Msg("server failed")
		}
	}()

	// Wait for shutdown signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	sig := <-quit
	log.Info().Str("signal", sig.String()).Msg("Gateway shutting down")
}
