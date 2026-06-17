package handler

import (
	"net/http"

	"github.com/encorehub/gateway/internal/engine"
	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"
)

// ConversationHandler proxies conversation CRUD to the Rust engine.
type ConversationHandler struct {
	engine *engine.Client
}

func NewConversationHandler(engineClient *engine.Client) *ConversationHandler {
	return &ConversationHandler{engine: engineClient}
}

type createConvReq struct {
	Title    string `json:"title"`
	Provider string `json:"provider"`
	Model    string `json:"model"`
}

func (h *ConversationHandler) Create(c *gin.Context) {
	var req createConvReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	conv, err := h.engine.CreateConversation(c.Request.Context(), req.Title, req.Provider, req.Model)
	if err != nil {
		log.Error().Err(err).Msg("engine create conversation failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, conv)
}

func (h *ConversationHandler) List(c *gin.Context) {
	resp, err := h.engine.ListConversations(c.Request.Context())
	if err != nil {
		log.Error().Err(err).Msg("engine list conversations failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, resp)
}

func (h *ConversationHandler) Get(c *gin.Context) {
	id := c.Param("id")
	conv, err := h.engine.GetConversation(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, conv)
}

func (h *ConversationHandler) Delete(c *gin.Context) {
	id := c.Param("id")

	req, err := http.NewRequest("DELETE", h.engine.BaseURL()+"/api/conversations/"+id, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "delete failed"})
		return
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode >= 400 {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "delete failed"})
		return
	}
	defer resp.Body.Close()

	c.Status(http.StatusNoContent)
}

type renameReq struct {
	Title string `json:"title" binding:"required"`
}

// Rename handles PATCH /api/v1/conversations/:id { title }
func (h *ConversationHandler) Rename(c *gin.Context) {
	id := c.Param("id")
	var req renameReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	conv, err := h.engine.RenameConversation(c.Request.Context(), id, req.Title)
	if err != nil {
		log.Error().Err(err).Msg("engine rename failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, conv)
}
