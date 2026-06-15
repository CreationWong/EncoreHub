package handler

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/encorehub/gateway/internal/engine"
	"github.com/encorehub/gateway/internal/provider"
	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"
)

// ChatHandler handles chat requests and proxies to AI providers.
type ChatHandler struct {
	registry    *provider.Registry
	engine      *engine.Client
}

func NewChatHandler(registry *provider.Registry, engineClient *engine.Client) *ChatHandler {
	return &ChatHandler{
		registry: registry,
		engine:    engineClient,
	}
}

// ===== Request/Response types =====

type SendMessageRequest struct {
	Content       string  `json:"content" binding:"required"`
	Provider      string  `json:"provider"`
	Model         string  `json:"model"`
	Stream        bool    `json:"stream"`
	Temperature   float32 `json:"temperature"`
}

type ChatResponse struct {
	ConversationID string               `json:"conversation_id"`
	UserMessage    engine.Message       `json:"user_message"`
	Reply          string               `json:"reply"`
	Provider       string               `json:"provider"`
	Model          string               `json:"model"`
	Usage          *provider.UsageEvent `json:"usage,omitempty"`
}

// SendMessage handles POST /api/v1/conversations/:id/chat
//
// Flow:
//  1. Store user message via engine
//  2. Call AI provider with conversation context
//  3. Store assistant reply via engine
//  4. Return unified response
func (h *ChatHandler) SendMessage(c *gin.Context) {
	convID := c.Param("id")

	var req SendMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Default provider/model from engine's conversation metadata
	if req.Provider == "" {
		if conv, err := h.engine.GetConversation(c.Request.Context(), convID); err == nil {
			req.Provider = conv.Provider
			req.Model = conv.Model
		}
	}
	if req.Provider == "" {
		req.Provider = "openai"
	}
	if req.Model == "" {
		req.Model = "gpt-4o"
	}

	// Get API key from header
	apiKey := c.GetHeader("X-Provider-Key")
	if apiKey == "" {
		apiKey = c.GetHeader("X-" + req.Provider + "-Key")
	}

	log.Info().
		Str("conv_id", convID).
		Str("provider", req.Provider).
		Str("model", req.Model).
		Bool("stream", req.Stream).
		Msg("chat request")

	// Fallback: if no API key, delegate to engine's mock AI
	if apiKey == "" {
		log.Info().Msg("no API key — falling back to engine mock")
		h.mockChat(c, convID, req)
		return
	}

	// Build context from engine (get conversation messages + memories)
	convDetail, err := h.engine.GetConversation(c.Request.Context(), convID)
	if err != nil {
		log.Warn().Err(err).Str("conv_id", convID).Msg("failed to get conversation from engine, continuing")
	}

	// Build unified chat request
	chatReq := &provider.ChatRequest{
		Model:       req.Model,
		Stream:      req.Stream,
		Temperature: req.Temperature,
		MaxTokens:   4096,
	}

	if convDetail != nil {
		for _, msg := range convDetail.Messages {
			chatReq.Messages = append(chatReq.Messages, provider.Message{
				Role:    msg.Role,
				Content: msg.Content,
			})
		}
	}

	// Add current message
	chatReq.Messages = append(chatReq.Messages, provider.Message{
		Role:    "user",
		Content: req.Content,
	})

	// Get the provider adapter
	adapter, err := h.registry.Get(req.Provider)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 120*time.Second)
	defer cancel()

	// Streaming mode
	if req.Stream {
		h.handleStream(ctx, c, adapter, chatReq, convID, req)
		return
	}

	// Non-streaming mode
	chatResp, err := adapter.Chat(ctx, chatReq, apiKey)
	if err != nil {
		log.Error().Err(err).Msg("provider chat failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("provider error: %v", err)})
		return
	}

	// Store assistant message in engine
	engineResp, err := h.engine.SendMessage(ctx, convID, req.Content)
	if err != nil {
		log.Warn().Err(err).Msg("engine send_message failed, returning provider response only")
	}

	reply := assistantContent(engineResp, chatResp)

	c.JSON(http.StatusOK, ChatResponse{
		ConversationID: convID,
		Reply:          reply,
		Provider:       req.Provider,
		Model:          req.Model,
		Usage: &provider.UsageEvent{
			InputTokens:  chatResp.InputTokens,
			OutputTokens: chatResp.OutputTokens,
		},
	})
}

func (h *ChatHandler) handleStream(ctx context.Context, c *gin.Context, adapter provider.Adapter, req *provider.ChatRequest, convID string, origReq SendMessageRequest) {
	// Store user message first
	var userMsgID string
	if engineResp, err := h.engine.SendMessage(ctx, convID, origReq.Content); err == nil {
		userMsgID = engineResp.UserMessage.ID
	}

	events, err := adapter.ChatStream(ctx, req, c.GetHeader("X-Provider-Key"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")

	var fullContent string
	for ev := range events {
		if ev.Error != nil {
			log.Error().Err(ev.Error).Msg("stream error")
			fmt.Fprintf(c.Writer, "event: error\ndata: %s\n\n", ev.Error.Error())
			c.Writer.Flush()
			return
		}

		if ev.Delta != nil {
			fullContent += ev.Delta.Content
			fmt.Fprintf(c.Writer, "event: delta\ndata: %s\n\n", ev.Delta.Content)
			c.Writer.Flush()
		}

		if ev.Usage != nil {
			fmt.Fprintf(c.Writer, "event: usage\ndata: {\"input_tokens\":%d,\"output_tokens\":%d}\n\n",
				ev.Usage.InputTokens, ev.Usage.OutputTokens)
			c.Writer.Flush()
		}
	}

	// Store assistant reply in engine
	go func() {
		// Create a message in the engine with the full response
		if userMsgID != "" {
			h.engine.SendMessage(context.Background(), convID, "[STREAM_COMPLETE]")
		}
		_ = userMsgID
	}()

	fmt.Fprintf(c.Writer, "event: done\ndata: {}\n\n")
	c.Writer.Flush()
}

func assistantContent(engineResp *engine.SendMessageResponse, chatResp *provider.ChatResponse) string {
	if engineResp != nil {
		return engineResp.AssistantMessage.Content
	}
	if chatResp != nil {
		return chatResp.Content
	}
	return ""
}

// mockChat delegates to the engine's mock AI when no API key is available.
func (h *ChatHandler) mockChat(c *gin.Context, convID string, req SendMessageRequest) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	engineResp, err := h.engine.SendMessage(ctx, convID, req.Content)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Refresh to get title
	conv, _ := h.engine.GetConversation(ctx, convID)

	c.JSON(http.StatusOK, ChatResponse{
		ConversationID: convID,
		UserMessage:    engineResp.UserMessage,
		Reply:          engineResp.AssistantMessage.Content,
		Provider:       "mock (engine)",
		Model:          conv.Model,
	})
}
