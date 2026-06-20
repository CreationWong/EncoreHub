package handler

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/encorehub/gateway/internal/engine"
	"github.com/encorehub/gateway/internal/provider"
	"github.com/encorehub/gateway/internal/search"
	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"
)

// devMockEnabled returns true only when ENCOREHUB_DEV_MOCK is explicitly set
// to "1" / "true". Mock replies must never be served from a production build.
func devMockEnabled() bool {
	v := os.Getenv("ENCOREHUB_DEV_MOCK")
	return v == "1" || v == "true"
}

type ChatHandler struct {
	registry *provider.Registry
	engine   *engine.Client
}

func NewChatHandler(registry *provider.Registry, engineClient *engine.Client) *ChatHandler {
	return &ChatHandler{registry: registry, engine: engineClient}
}

type SendMessageRequest struct {
	Content     string  `json:"content" binding:"required"`
	Provider    string  `json:"provider"`
	Model       string  `json:"model"`
	Stream      bool    `json:"stream"`
	Search      bool    `json:"search"`
	Temperature float32 `json:"temperature"`
}

type ChatResponse struct {
	ConversationID string               `json:"conversation_id"`
	UserMessage    engine.Message       `json:"user_message,omitempty"`
	Reply          string               `json:"reply"`
	Provider       string               `json:"provider"`
	Model          string               `json:"model"`
	Usage          *provider.UsageEvent `json:"usage,omitempty"`
}

// SendMessage handles POST /api/v1/conversations/:id/chat
func (h *ChatHandler) SendMessage(c *gin.Context) {
	convID := c.Param("id")
	var req SendMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Resolve provider/model from engine metadata if not specified
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

	apiKey := c.GetHeader("X-Provider-Key")
	if apiKey == "" {
		apiKey = c.GetHeader("X-" + req.Provider + "-Key")
	}
	// Fall back to a key stored in the engine (encrypted-secrets mode). When
	// the DB is locked or no key is stored, GetSecret returns found=false and
	// we proceed as if no key was supplied. Never log the key itself.
	if apiKey == "" {
		if k, found, err := h.engine.GetSecret(c.Request.Context(), req.Provider); err != nil {
			log.Debug().Err(err).Msg("engine secret lookup failed (non-fatal)")
		} else if found {
			apiKey = k
		}
	}

	log.Info().
		Str("conv_id", convID).
		Str("provider", req.Provider).
		Str("model", req.Model).
		Bool("stream", req.Stream).
		Bool("has_key", apiKey != "").
		Msg("chat request")

	// Step 1: Always store the user message in the engine first.
	userMsgID := h.storeUserMessage(convID, req.Content)

	// Step 1.5: Optional web search
	var searchContext string
	if req.Search {
		ddg := search.NewDuckDuckGo()
		searchResp, err := ddg.Search(c.Request.Context(), req.Content, 5)
		if err != nil {
			log.Warn().Err(err).Msg("web search failed")
		} else {
			searchContext = search.FormatForContext(searchResp)
			log.Info().Int("results", len(searchResp.Results)).Msg("web search completed")
		}
	}

	// Step 2: Pull relevant memories + knowledge chunks via the engine client
	// (uses ENGINE_URL — no hardcoded localhost).
	var memoryContext string
	if hits, err := h.engine.SearchMemories(c.Request.Context(), req.Content, 3); err == nil && len(hits) > 0 {
		memoryContext = "\n\n[Relevant Memories]\n"
		for i, m := range hits {
			memoryContext += fmt.Sprintf("%d. [%s] %s\n", i+1, m.Scope, m.Content)
		}
	} else if err != nil {
		log.Debug().Err(err).Msg("memory search failed (non-fatal)")
	}

	var knowledgeContext string
	if hits, err := h.engine.SearchKnowledge(c.Request.Context(), req.Content, 3); err == nil && len(hits) > 0 {
		knowledgeContext = "\n\n[Knowledge Base]\n"
		for i, k := range hits {
			knowledgeContext += fmt.Sprintf("%d. (chunk %d, score %.2f) %s\n", i+1, k.ChunkIndex, k.Score, k.Content)
		}
	} else if err != nil {
		log.Debug().Err(err).Msg("knowledge search failed (non-fatal)")
	}

	// Step 4: Build chat request (includes messages + search results + memory + knowledge context)
	systemExtra := searchContext + memoryContext + knowledgeContext
	var chatReq *provider.ChatRequest
	if convDetail, err := h.engine.GetConversation(c.Request.Context(), convID); err == nil {
		chatReq = buildChatRequest(convDetail, req, systemExtra)
	} else {
		chatReq = &provider.ChatRequest{
			Model:       req.Model,
			Stream:      req.Stream,
			Temperature: req.Temperature,
			MaxTokens:   4096,
			SystemPrompt: "You are EncoreHub, a helpful AI assistant. Use provided context." + systemExtra,
			Messages: []provider.Message{
				{Role: "user", Content: req.Content},
			},
		}
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 120*time.Second)
	defer cancel()

	// Step 3: If no API key, refuse — unless ENCOREHUB_DEV_MOCK is set,
	// in which case fall through to the canned replies below.
	if apiKey == "" {
		if !devMockEnabled() {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "missing provider API key (X-Provider-Key header). " +
					"Set ENCOREHUB_DEV_MOCK=1 to enable mock replies in development.",
			})
			return
		}
		log.Warn().Msg("ENCOREHUB_DEV_MOCK active — serving mock reply")
		if req.Stream {
			h.mockStream(c, convID, userMsgID, req)
		} else {
			h.mockReply(c, convID, userMsgID, req)
		}
		return
	}

	// Step 4: Call real AI provider
	adapter, err := h.registry.Get(req.Provider)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Stream {
		h.providerStream(ctx, c, adapter, chatReq, apiKey, convID, userMsgID, req)
		return
	}

	// Non-streaming
	chatResp, err := adapter.Chat(ctx, chatReq, apiKey)
	if err != nil {
		log.Error().Err(err).Msg("provider chat failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("provider error: %v", err)})
		return
	}

	// Store assistant reply in engine
	h.storeAssistantMessage(convID, userMsgID, chatResp.Content)

	c.JSON(http.StatusOK, ChatResponse{
		ConversationID: convID,
		Reply:          chatResp.Content,
		Provider:       req.Provider,
		Model:          req.Model,
		Usage: &provider.UsageEvent{
			InputTokens:  chatResp.InputTokens,
			OutputTokens: chatResp.OutputTokens,
		},
	})
}

// ===== Streaming (real provider) =====

func (h *ChatHandler) providerStream(ctx context.Context, c *gin.Context, adapter provider.Adapter,
	req *provider.ChatRequest, apiKey, convID, userMsgID string, origReq SendMessageRequest) {

	events, err := adapter.ChatStream(ctx, req, apiKey)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Status(http.StatusOK)

	var fullContent string
	flusher, _ := c.Writer.(http.Flusher)

	for ev := range events {
		if ev.Error != nil {
			log.Error().Err(ev.Error).Msg("stream error")
			fmt.Fprintf(c.Writer, "event: error\ndata: %s\n\n", ev.Error.Error())
			if flusher != nil {
				flusher.Flush()
			}
			return
		}
		if ev.Delta != nil {
			fullContent += ev.Delta.Content
			fmt.Fprintf(c.Writer, "event: delta\ndata: %s\n\n", ev.Delta.Content)
			if flusher != nil {
				flusher.Flush()
			}
		}
		if ev.Usage != nil {
			fmt.Fprintf(c.Writer, "event: usage\ndata: {\"input_tokens\":%d,\"output_tokens\":%d}\n\n",
				ev.Usage.InputTokens, ev.Usage.OutputTokens)
			if flusher != nil {
				flusher.Flush()
			}
		}
	}

	// Store assistant reply
	go h.storeAssistantMessage(convID, userMsgID, fullContent)

	fmt.Fprintf(c.Writer, "event: done\ndata: {}\n\n")
	if flusher != nil {
		flusher.Flush()
	}
}

// ===== Mock mode =====

func (h *ChatHandler) mockReply(c *gin.Context, convID string, userMsgID string, req SendMessageRequest) {
	reply := generateMockReply(req.Content)
	h.storeAssistantMessage(convID, userMsgID, reply)
	c.JSON(http.StatusOK, ChatResponse{
		ConversationID: convID,
		Reply:          reply,
		Provider:       "mock (engine)",
		Model:          req.Model,
	})
}

func (h *ChatHandler) mockStream(c *gin.Context, convID string, userMsgID string, req SendMessageRequest) {
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Status(http.StatusOK)

	flusher, _ := c.Writer.(http.Flusher)
	reply := generateMockReply(req.Content)

	// Stream the mock reply character by character (simulated typing)
	for i, ch := range reply {
		fmt.Fprintf(c.Writer, "event: delta\ndata: %s\n\n", string(ch))
		if flusher != nil {
			flusher.Flush()
		}
		// Small delay for typing effect
		if i%3 == 0 {
			time.Sleep(15 * time.Millisecond)
		}
	}

	// Store assistant reply
	go h.storeAssistantMessage(convID, userMsgID, reply)

	fmt.Fprintf(c.Writer, "event: done\ndata: {}\n\n")
	if flusher != nil {
		flusher.Flush()
	}
}

// ===== Engine helpers =====

func (h *ChatHandler) storeUserMessage(convID, content string) string {
	msg, err := h.engine.AppendMessage(context.Background(), convID, content, "user", "")
	if err != nil {
		log.Warn().Err(err).Msg("failed to store user message via engine")
		return fmt.Sprintf("user-%d", time.Now().UnixNano())
	}
	return msg.ID
}

func (h *ChatHandler) storeAssistantMessage(convID, userMsgID, content string) {
	_, err := h.engine.AppendMessage(context.Background(), convID, content, "assistant", userMsgID)
	if err != nil {
		log.Warn().Err(err).Msg("failed to store assistant message via engine")
	}
	log.Debug().Str("conv_id", convID).Int("len", len(content)).Msg("assistant reply stored")
}

// ===== Helpers =====

func buildChatRequest(conv *engine.ConversationDetail, req SendMessageRequest, systemExtra string) *provider.ChatRequest {
	cr := &provider.ChatRequest{
		Model:       req.Model,
		Stream:      req.Stream,
		Temperature: req.Temperature,
		MaxTokens:   4096,
	}
	cr.SystemPrompt = "You are EncoreHub, a helpful AI assistant. Answer concisely and accurately." + systemExtra

	for _, msg := range conv.Messages {
		cr.Messages = append(cr.Messages, provider.Message{
			Role:    msg.Role,
			Content: msg.Content,
		})
	}
	return cr
}

func generateMockReply(userInput string) string {
	input := userInput
	if len(input) > 100 {
		input = input[:100] + "..."
	}

	switch {
	case containsLower(input, "hello") || containsLower(input, "hi") || containsLower(input, "你好"):
		return "Hello! I'm EncoreHub's assistant (mock mode). How can I help you today?\n\nTry searching the web — add `\"search\": true` to your request!"
	case containsLower(input, "who are you") || containsLower(input, "你是谁"):
		return "I'm EncoreHub, a multi-provider AI chat client. I support OpenAI, Anthropic, Gemini, DuckDuckGo web search, and more. Connect an API key to use real AI!"
	case containsLower(input, "memory") || containsLower(input, "记忆"):
		return "**Memory System**\n\n- Conversation memory: active (SQLite FTS5 + LanceDB)\n- Global memory: cross-conversation retrieval\n- Search: `GET /api/memories/search?q=...`\n- All messages persisted and searchable."
	case containsLower(input, "help") || containsLower(input, "帮助"):
		return "**EncoreHub Commands**\n\n- `hello` — greeting\n- `who are you` — about\n- `memory` — memory status\n- `help` — this message\n- `search: true` in request → DuckDuckGo web search"
	default:
		return fmt.Sprintf("[Mock Reply]\n\nYou said: \"%s\"\n\nAdd an API key to use real AI, or enable `search: true` for web search results.", input)
	}
}

func containsLower(s, substr string) bool {
	return len(s) >= len(substr) && containsStr(toLower(s), substr)
}

func toLower(s string) string {
	b := make([]byte, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' {
			c += 32
		}
		b[i] = c
	}
	return string(b)
}

func containsStr(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
