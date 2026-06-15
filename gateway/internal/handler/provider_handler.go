package handler

import (
	"net/http"

	"github.com/encorehub/gateway/internal/provider"
	"github.com/gin-gonic/gin"
)

// ProviderHandler handles provider/model listing requests.
type ProviderHandler struct {
	registry *provider.Registry
}

func NewProviderHandler(registry *provider.Registry) *ProviderHandler {
	return &ProviderHandler{registry: registry}
}

// ListProviders returns all registered provider IDs.
func (h *ProviderHandler) ListProviders(c *gin.Context) {
	ids := h.registry.List()
	c.JSON(http.StatusOK, gin.H{
		"providers": ids,
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
