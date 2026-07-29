package handler

import (
	"net/http"
	"strings"

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
	Title       string `json:"title"`
	Provider    string `json:"provider"`
	Model       string `json:"model"`
	CharacterID string `json:"character_id"`
}

func (h *ConversationHandler) Create(c *gin.Context) {
	var req createConvReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	conv, err := h.engine.CreateConversation(
		c.Request.Context(), req.Title, req.Provider, req.Model, req.CharacterID,
	)
	if err != nil {
		engineStatus := engine.ErrorStatus(err)
		status := http.StatusBadGateway
		switch engineStatus {
		case http.StatusBadRequest, http.StatusNotFound, http.StatusConflict:
			status = engineStatus
		}
		log.Error().Int("engine_status", engineStatus).Msg("engine create conversation failed")
		c.JSON(status, gin.H{"error": "create conversation failed"})
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
	if err := h.engine.DeleteConversation(c.Request.Context(), id); err != nil {
		log.Error().Err(err).Msg("engine delete conversation failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "delete failed"})
		return
	}

	c.Status(http.StatusNoContent)
}

type updateConvReq struct {
	Title    *string `json:"title"`
	Provider *string `json:"provider"`
	Model    *string `json:"model"`
}

// Rename handles PATCH updates to title or authoritative provider/model metadata.
func (h *ConversationHandler) Rename(c *gin.Context) {
	id := c.Param("id")
	var req updateConvReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Title == nil && req.Provider == nil && req.Model == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "at least one field is required"})
		return
	}
	if (req.Provider == nil) != (req.Model == nil) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "provider and model must be updated together"})
		return
	}
	if req.Title != nil {
		trimmed := strings.TrimSpace(*req.Title)
		if trimmed == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "title cannot be empty"})
			return
		}
		req.Title = &trimmed
	}
	if req.Provider != nil && req.Model != nil {
		provider := strings.TrimSpace(*req.Provider)
		model := strings.TrimSpace(*req.Model)
		if provider == "" || model == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "provider and model cannot be empty"})
			return
		}
		req.Provider = &provider
		req.Model = &model
	}

	conv, err := h.engine.UpdateConversation(c.Request.Context(), id, engine.ConversationUpdate{
		Title:    req.Title,
		Provider: req.Provider,
		Model:    req.Model,
	})
	if err != nil {
		log.Error().Err(err).Msg("engine conversation update failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, conv)
}
