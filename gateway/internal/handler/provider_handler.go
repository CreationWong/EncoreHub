package handler

import (
	"net/http"
	"sync/atomic"
	"time"

	"github.com/encorehub/gateway/internal/provider"
	"github.com/gin-gonic/gin"
)

// ProviderHandler serves provider profile listing/editing and model listing.
type ProviderHandler struct {
	registry *provider.Registry
	store    *ProfileStore
	client   *http.Client
	// discoveryKeyNext rotates draft key pools without persisting state.
	discoveryKeyNext atomic.Uint64
}

func NewProviderHandler(registry *provider.Registry, store *ProfileStore) *ProviderHandler {
	return &ProviderHandler{
		registry: registry,
		store:    store,
		client:   &http.Client{Timeout: 15 * time.Second},
	}
}

// updateProvidersRequest is the PUT body: the full desired profile list.
type updateProvidersRequest struct {
	Providers []provider.ProviderProfile `json:"providers"`
}

// ListProviders returns the full provider profile list (builtin-first).
func (h *ProviderHandler) ListProviders(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"providers": sortedProfiles(h.store.Profiles()),
	})
}

// UpdateProviders replaces the entire profile list. The frontend sends the
// whole desired set; the store validates, persists to the engine, and rebuilds
// the live registry.
func (h *ProviderHandler) UpdateProviders(c *gin.Context) {
	var req updateProvidersRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.store.Save(c.Request.Context(), req.Providers); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"providers": sortedProfiles(h.store.Profiles()),
	})
}

// ListModels returns models for a specific provider.
func (h *ProviderHandler) ListModels(c *gin.Context) {
	providerID := c.Param("provider")

	adapter, err := h.registry.Get(providerID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	apiKey := c.GetHeader("X-" + providerID + "-Key")
	if apiKey == "" {
		apiKey = c.GetHeader("X-Provider-Key")
	}

	models, err := adapter.ListModels(c.Request.Context(), apiKey)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"provider": providerID,
		"models":   models,
	})
}
