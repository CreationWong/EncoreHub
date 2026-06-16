package handler

import (
	"context"
	"net/http"
	"time"

	"github.com/encorehub/gateway/internal/engine"
	"github.com/gin-gonic/gin"
)

// HealthHandler reports gateway + engine reachability.
type HealthHandler struct {
	engine *engine.Client
}

func NewHealthHandler(eng *engine.Client) *HealthHandler {
	return &HealthHandler{engine: eng}
}

type engineStatus struct {
	URL       string `json:"url"`
	OK        bool   `json:"ok"`
	LatencyMs int64  `json:"latency_ms"`
	Error     string `json:"error,omitempty"`
}

type healthResponse struct {
	Status  string       `json:"status"`
	Service string       `json:"service"`
	Engine  engineStatus `json:"engine"`
}

const engineProbeTimeout = 1500 * time.Millisecond

// Get returns 200 with detailed status. The endpoint stays 200 even if the
// engine probe fails — container orchestrators usually want gateway liveness
// (the process is up) separately from engine readiness (downstream is healthy).
// Inspect `engine.ok` to react to the dependency state.
func (h *HealthHandler) Get(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), engineProbeTimeout)
	defer cancel()

	es := engineStatus{URL: h.engine.BaseURL()}
	start := time.Now()
	if err := h.engine.Health(ctx); err != nil {
		es.OK = false
		es.Error = err.Error()
	} else {
		es.OK = true
	}
	es.LatencyMs = time.Since(start).Milliseconds()

	c.JSON(http.StatusOK, healthResponse{
		Status:  "ok",
		Service: "encorehub-gateway",
		Engine:  es,
	})
}
