package handler

import (
	"errors"
	"net/http"
	"strings"

	"github.com/encorehub/gateway/internal/search"
	"github.com/gin-gonic/gin"
)

const maxSearchRequestBytes = 8 << 10

type SearchHandler struct {
	provider search.Provider
}

func NewSearchHandler(providers ...search.Provider) *SearchHandler {
	provider := search.Provider(search.NewDuckDuckGo())
	if len(providers) > 0 && providers[0] != nil {
		provider = providers[0]
	}
	return &SearchHandler{provider: provider}
}

type SearchRequest struct {
	Query      string `json:"query" binding:"required"`
	MaxResults int    `json:"max_results"`
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
	if req.MaxResults == 0 {
		req.MaxResults = search.DefaultMaxResults
	}
	req.Query = strings.TrimSpace(req.Query)
	if err := search.ValidateRequest(req.Query, req.MaxResults); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	resp, err := h.provider.Search(c.Request.Context(), req.Query, req.MaxResults)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "search provider request failed"})
		return
	}

	c.JSON(http.StatusOK, resp)
}
