package handler

import (
	"errors"
	"net/http"
	"strings"

	// Internal packages use EncoreHub's stable reverse-domain namespace.
	"com.0d000721.encorehub/gateway/internal/engine"
	"com.0d000721.encorehub/gateway/internal/search"
	"github.com/gin-gonic/gin"
)

const maxSearchRequestBytes = 8 << 10

type SearchHandler struct {
	provider search.Provider
	engine   *engine.Client
}

func NewSearchHandler(engineClient *engine.Client, providers ...search.Provider) *SearchHandler {
	var provider search.Provider
	if len(providers) > 0 && providers[0] != nil {
		provider = providers[0]
	}
	return &SearchHandler{provider: provider, engine: engineClient}
}

type SearchRequest struct {
	Query      string `json:"query" binding:"required"`
	MaxResults int    `json:"max_results"`
	Provider   string `json:"provider"`
}

func (h *SearchHandler) Search(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxSearchRequestBytes)
	var req SearchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "search request body too large"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	provider := h.provider
	if provider == nil {
		resolved, settings, err := resolveWebSearchProvider(
			c.Request.Context(),
			h.engine,
			req.Provider,
		)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		provider = resolved
		if req.MaxResults == 0 {
			req.MaxResults = settings.MaxResults
		}
	} else if req.MaxResults == 0 {
		req.MaxResults = search.DefaultMaxResults
	}
	req.Query = strings.TrimSpace(req.Query)
	if err := search.ValidateRequest(req.Query, req.MaxResults); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	resp, err := provider.Search(c.Request.Context(), req.Query, req.MaxResults)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "search provider request failed"})
		return
	}

	c.JSON(http.StatusOK, resp)
}
