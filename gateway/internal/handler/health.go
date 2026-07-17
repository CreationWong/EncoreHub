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

type livenessResponse struct {
	Status  string `json:"status"`
	Service string `json:"service"`
}

const engineProbeTimeout = 1500 * time.Millisecond

// Live reports only Gateway process liveness and never probes dependencies.
func (h *HealthHandler) Live(c *gin.Context) {
	c.JSON(http.StatusOK, livenessResponse{
		Status:  "ok",
		Service: "encorehub-gateway",
	})
}

// Ready reports Gateway readiness and requires Engine database readiness.
func (h *HealthHandler) Ready(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), engineProbeTimeout)
	defer cancel()

	es := engineStatus{URL: h.engine.BaseURL()}
	start := time.Now()
	if err := h.engine.Readiness(ctx); err != nil {
		es.OK = false
		es.Error = "engine readiness check failed"
	} else {
		es.OK = true
	}
	es.LatencyMs = time.Since(start).Milliseconds()

	status := http.StatusOK
	statusText := "ok"
	if !es.OK {
		status = http.StatusServiceUnavailable
		statusText = "not_ready"
	}
	c.JSON(status, healthResponse{
		Status:  statusText,
		Service: "encorehub-gateway",
		Engine:  es,
	})
}

// Get preserves the former handler method as a readiness alias.
func (h *HealthHandler) Get(c *gin.Context) {
	h.Ready(c)
}
