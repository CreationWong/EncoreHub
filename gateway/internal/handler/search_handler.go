package handler

import (
	"net/http"

	"github.com/encorehub/gateway/internal/search"
	"github.com/gin-gonic/gin"
)

type SearchHandler struct{}

func NewSearchHandler() *SearchHandler {
	return &SearchHandler{}
}

type SearchRequest struct {
	Query      string `json:"query" binding:"required"`
	MaxResults int    `json:"max_results"`
}

func (h *SearchHandler) Search(c *gin.Context) {
	var req SearchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.MaxResults == 0 {
		req.MaxResults = 5
	}

	ddg := search.NewDuckDuckGo()
	resp, err := ddg.Search(c.Request.Context(), req.Query, req.MaxResults)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, resp)
}
