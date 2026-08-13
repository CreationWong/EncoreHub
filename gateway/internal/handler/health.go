package handler

import (
	"context"
	"fmt"
	"net/http"
	"time"

	// Internal packages use EncoreHub's stable reverse-domain namespace.
	"com.0d000721.encorehub/gateway/internal/buildinfo"
	"com.0d000721.encorehub/gateway/internal/engine"
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
	URL         string            `json:"url"`
	OK          bool              `json:"ok"`
	LatencyMs   int64             `json:"latency_ms"`
	Error       string            `json:"error,omitempty"`
	VersionInfo *buildinfo.Record `json:"version_info,omitempty"`
}

type healthResponse struct {
	Status      string           `json:"status"`
	Service     string           `json:"service"`
	VersionInfo buildinfo.Record `json:"version_info"`
	Engine      engineStatus     `json:"engine"`
}

type livenessResponse struct {
	Status      string           `json:"status"`
	Service     string           `json:"service"`
	VersionInfo buildinfo.Record `json:"version_info"`
}

const engineProbeTimeout = 1500 * time.Millisecond

// Live reports only Gateway process liveness and never probes dependencies.
func (h *HealthHandler) Live(c *gin.Context) {
	c.JSON(http.StatusOK, livenessResponse{
		Status:      "ok",
		Service:     "encorehub-gateway",
		VersionInfo: buildinfo.Current(),
	})
}

// Ready reports Gateway readiness and requires Engine database readiness.
func (h *HealthHandler) Ready(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), engineProbeTimeout)
	defer cancel()

	es := engineStatus{URL: h.engine.BaseURL()}
	start := time.Now()
	engineInfo, err := h.engine.ReadinessWithCompatibility(ctx)
	if engineInfo.Component != "" {
		es.VersionInfo = &buildinfo.Record{
			Component:     engineInfo.Component,
			Version:       engineInfo.Version,
			BuildID:       engineInfo.BuildID,
			Compatibility: engineInfo.Compatibility,
		}
	}
	if err != nil {
		es.OK = false
		if es.VersionInfo != nil {
			gateway := buildinfo.Current()
			es.Error = fmt.Sprintf(
				"component compatibility failed: gateway %s (Build %s), engine %s (Build %s)",
				gateway.Version,
				gateway.BuildID,
				es.VersionInfo.Version,
				es.VersionInfo.BuildID,
			)
		} else {
			es.Error = "engine readiness check failed"
		}
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
		Status:      statusText,
		Service:     "encorehub-gateway",
		VersionInfo: buildinfo.Current(),
		Engine:      es,
	})
}

// Get preserves the former handler method as a readiness alias.
func (h *HealthHandler) Get(c *gin.Context) {
	h.Ready(c)
}
