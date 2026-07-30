package handler

import (
	"net/http"

	// Internal packages use EncoreHub's stable reverse-domain namespace.
	"com.0d000721.encorehub/gateway/internal/engine"
	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

// LogLevelHandler adjusts the log level at runtime for both the gateway
// (zerolog global level, applied immediately) and the engine (persisted to the
// shared `log_level` config key, which the engine applies via its reload layer).
type LogLevelHandler struct {
	engine *engine.Client
}

func NewLogLevelHandler(eng *engine.Client) *LogLevelHandler {
	return &LogLevelHandler{engine: eng}
}

type logLevelRequest struct {
	Level string `json:"level" binding:"required"`
}

// parseLevel maps a user level string to a zerolog level. Returns ok=false for
// anything outside the accepted set.
func parseLevel(s string) (zerolog.Level, bool) {
	switch s {
	case "error":
		return zerolog.ErrorLevel, true
	case "warn", "warning":
		return zerolog.WarnLevel, true
	case "info":
		return zerolog.InfoLevel, true
	case "debug":
		return zerolog.DebugLevel, true
	case "trace":
		return zerolog.TraceLevel, true
	default:
		return zerolog.InfoLevel, false
	}
}

// Set handles POST /api/v1/log-level. Body: {"level":"info"}.
func (h *LogLevelHandler) Set(c *gin.Context) {
	var req logLevelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	lvl, ok := parseLevel(req.Level)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid log level: " + req.Level})
		return
	}

	// Apply to the gateway immediately.
	zerolog.SetGlobalLevel(lvl)
	log.Info().Str("level", req.Level).Msg("gateway log level changed")

	// Persist to the engine's config; the engine applies it to its own
	// subscriber via the reload layer. Non-fatal: the gateway level is already
	// changed, so report partial success rather than failing the whole call.
	engineApplied := true
	if err := h.engine.SetConfig(c.Request.Context(), "log_level", req.Level); err != nil {
		engineApplied = false
		log.Warn().Err(err).Msg("failed to persist log level to engine")
	}

	c.JSON(http.StatusOK, gin.H{
		"level":          req.Level,
		"engine_applied": engineApplied,
	})
}

// Get handles GET /api/v1/log-level — returns the persisted level (or "info").
func (h *LogLevelHandler) Get(c *gin.Context) {
	var level string
	if err := h.engine.GetConfig(c.Request.Context(), "log_level", &level); err != nil || level == "" {
		level = "info"
	}
	c.JSON(http.StatusOK, gin.H{"level": level})
}

// ApplyInitialLevel reads the persisted log_level from the engine at startup and
// applies it to the gateway's zerolog. Falls back to info on any error.
func ApplyInitialLevel(eng *engine.Client) {
	var level string
	if err := eng.GetConfig(nil, "log_level", &level); err != nil || level == "" {
		zerolog.SetGlobalLevel(zerolog.InfoLevel)
		return
	}
	if lvl, ok := parseLevel(level); ok {
		zerolog.SetGlobalLevel(lvl)
		log.Info().Str("level", level).Msg("applied persisted log level")
	} else {
		zerolog.SetGlobalLevel(zerolog.InfoLevel)
	}
}
