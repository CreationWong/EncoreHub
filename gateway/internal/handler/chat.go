package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
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
	Content            string   `json:"content" binding:"required"`
	Provider           string   `json:"provider"`
	Model              string   `json:"model"`
	Stream             bool     `json:"stream"`
	Search             bool     `json:"search"`
	SearchProvider     string   `json:"search_provider"` // "duckduckgo" | "bing" | "google"
	Temperature        float32  `json:"temperature"`
	TopP               float32  `json:"top_p"`
	MaxTokens          int      `json:"max_tokens"`
	MaxCompletionTokens int     `json:"max_completion_tokens"`
	FrequencyPenalty   float32  `json:"frequency_penalty"`
	PresencePenalty    float32  `json:"presence_penalty"`
	Stop               []string `json:"stop"`
	Seed               *int     `json:"seed"`
	JSONMode           bool     `json:"json_mode"`
	ReasoningEffort    string   `json:"reasoning_effort"`
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

	// Step 1.5: Optional web search — fetches real-time results and
	// injects them into the system prompt so the model has up-to-date
	// information without needing a tool-call round-trip.
	var searchContext string
	if req.Search {
		sp := req.SearchProvider
		if sp == "" {
			sp = "duckduckgo"
		}
		searchAPIKey := ""
		switch sp {
		case "bing":
			searchAPIKey = os.Getenv("BING_SEARCH_API_KEY")
		case "google":
			searchAPIKey = os.Getenv("GOOGLE_SEARCH_API_KEY")
		}
		searchProvider, err := search.NewProvider(sp, searchAPIKey,
			search.WithGoogleCSEcx(os.Getenv("GOOGLE_CSE_CX")),
		)
		if err != nil {
			log.Warn().Err(err).Str("provider", sp).Msg("web search provider init failed")
		} else {
			searchResp, err := searchProvider.Search(c.Request.Context(), req.Content, 5)
			if err != nil {
				log.Warn().Err(err).Str("provider", sp).Msg("web search failed")
			} else {
				searchContext = search.FormatForContext(searchResp)
				// Prepend an explicit note so the model knows the search
				// has already been executed and doesn't claim it can't search.
				searchContext = fmt.Sprintf(
					"\n\n[IMPORTANT: The user's message triggered a web search via %s. "+
						"The results below are real-time and have already been fetched. "+
						"Use them to answer accurately. Do NOT say you cannot search the web.]",
					strings.ToUpper(sp)) + searchContext
				log.Info().Str("provider", sp).Int("results", len(searchResp.Results)).Msg("web search completed")
			}
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
		cr := &provider.ChatRequest{
			Model:               req.Model,
			Stream:              req.Stream,
			Temperature:         req.Temperature,
			TopP:                req.TopP,
			MaxTokens:           req.MaxTokens,
			MaxCompletionTokens: req.MaxCompletionTokens,
			FrequencyPenalty:    req.FrequencyPenalty,
			PresencePenalty:     req.PresencePenalty,
			Stop:                req.Stop,
			Seed:                req.Seed,
			JSONMode:            req.JSONMode,
			ReasoningEffort:     req.ReasoningEffort,
			SystemPrompt: "You are EncoreHub, a helpful AI assistant. Answer concisely and accurately. " +
			"You have access to real-time web search (DuckDuckGo, Bing, Google) — when the user enables it via the globe icon in the chat input, search results are automatically fetched and injected below. If you see [Web Search Results] in the context, those results are already fetched — use them; do NOT claim you cannot search. If the user asks for real-time or up-to-date information but no search results are present, suggest they click the globe icon to enable it." + systemExtra,
			Messages: []provider.Message{
				{Role: "user", Content: req.Content},
			},
		}
		if cr.MaxTokens == 0 {
			cr.MaxTokens = 4096
		}
		chatReq = cr
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
	h.storeAssistantMessage(convID, userMsgID, chatResp.Content, "", nil, chatResp.InputTokens+chatResp.OutputTokens)

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
	var fullReasoning string
	var totalTokens int
	agg := newToolCallAggregator()
	flusher, _ := c.Writer.(http.Flusher)

	writeFrame := func(event string, payload any) {
		data, err := json.Marshal(payload)
		if err != nil {
			return
		}
		fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", event, data)
		if flusher != nil {
			flusher.Flush()
		}
	}

	for ev := range events {
		switch {
		case ev.Error != nil:
			log.Error().Err(ev.Error).Msg("stream error")
			fmt.Fprintf(c.Writer, "event: error\ndata: %s\n\n", ev.Error.Error())
			if flusher != nil {
				flusher.Flush()
			}
			return
		case ev.Reasoning != nil:
			fullReasoning += ev.Reasoning.Content
			writeFrame("reasoning", map[string]string{"content": ev.Reasoning.Content})
		case ev.ToolCall != nil:
			agg.add(ev.ToolCall)
			writeFrame("tool_call", ev.ToolCall)
		case ev.ToolResult != nil:
			agg.setResult(ev.ToolResult)
			writeFrame("tool_result", ev.ToolResult)
		case ev.Delta != nil:
			if ev.Delta.Content != "" {
				fullContent += ev.Delta.Content
				writeFrame("delta", map[string]string{"content": ev.Delta.Content})
			}
		case ev.Usage != nil:
			totalTokens = ev.Usage.InputTokens + ev.Usage.OutputTokens
			writeFrame("usage", map[string]int{
				"input_tokens":  ev.Usage.InputTokens,
				"output_tokens": ev.Usage.OutputTokens,
			})
		}
	}

	// Store assistant reply with reasoning + tool calls.
	go h.storeAssistantMessage(convID, userMsgID, fullContent, fullReasoning, agg.toInputs(), totalTokens)

	fmt.Fprintf(c.Writer, "event: done\ndata: {}\n\n")
	if flusher != nil {
		flusher.Flush()
	}
}

// toolCallAggregator reassembles streamed tool-call fragments (which arrive
// keyed by index, with arguments split across chunks) into whole calls.
type toolCallAggregator struct {
	order []int
	calls map[int]*engine.ToolCallInput
}

func newToolCallAggregator() *toolCallAggregator {
	return &toolCallAggregator{calls: make(map[int]*engine.ToolCallInput)}
}

func (a *toolCallAggregator) add(ev *provider.ToolCallEvent) {
	tc, ok := a.calls[ev.Index]
	if !ok {
		tc = &engine.ToolCallInput{Status: "pending"}
		a.calls[ev.Index] = tc
		a.order = append(a.order, ev.Index)
	}
	if ev.Name != "" {
		tc.Name = ev.Name
	}
	tc.Arguments += ev.Arguments
}

func (a *toolCallAggregator) setResult(ev *provider.ToolResultEvent) {
	for _, tc := range a.calls {
		if tc.Status == "pending" {
			tc.Result = ev.Result
			tc.Status = ev.Status
			return
		}
	}
}

func (a *toolCallAggregator) toInputs() []engine.ToolCallInput {
	out := make([]engine.ToolCallInput, 0, len(a.order))
	for _, idx := range a.order {
		tc := a.calls[idx]
		if tc.Name == "" {
			continue
		}
		out = append(out, *tc)
	}
	return out
}

// ===== Mock mode =====

func (h *ChatHandler) mockReply(c *gin.Context, convID string, userMsgID string, req SendMessageRequest) {
	reply := generateMockReply(req.Content)
	h.storeAssistantMessage(convID, userMsgID, reply, "", nil, 0)
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
		data, _ := json.Marshal(map[string]string{"content": string(ch)})
		fmt.Fprintf(c.Writer, "event: delta\ndata: %s\n\n", data)
		if flusher != nil {
			flusher.Flush()
		}
		// Small delay for typing effect
		if i%3 == 0 {
			time.Sleep(15 * time.Millisecond)
		}
	}

	// Store assistant reply
	go h.storeAssistantMessage(convID, userMsgID, reply, "", nil, 0)

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

func (h *ChatHandler) storeAssistantMessage(convID, userMsgID, content, reasoning string, toolCalls []engine.ToolCallInput, tokenCount int) {
	_, err := h.engine.AppendMessageFull(context.Background(), convID, engine.AppendMessageRequest{
		Content:    content,
		Role:       "assistant",
		ParentID:   userMsgID,
		Reasoning:  reasoning,
		TokenCount: tokenCount,
		ToolCalls:  toolCalls,
	})
	if err != nil {
		log.Warn().Err(err).Msg("failed to store assistant message via engine")
	}
	log.Debug().Str("conv_id", convID).Int("len", len(content)).Msg("assistant reply stored")
}

// ===== Helpers =====

func buildChatRequest(conv *engine.ConversationDetail, req SendMessageRequest, systemExtra string) *provider.ChatRequest {
	cr := &provider.ChatRequest{
		Model:               req.Model,
		Stream:              req.Stream,
		Temperature:         req.Temperature,
		TopP:                req.TopP,
		MaxTokens:           req.MaxTokens,
		MaxCompletionTokens: req.MaxCompletionTokens,
		FrequencyPenalty:    req.FrequencyPenalty,
		PresencePenalty:     req.PresencePenalty,
		Stop:                req.Stop,
		Seed:                req.Seed,
		JSONMode:            req.JSONMode,
		ReasoningEffort:     req.ReasoningEffort,
	}
	if cr.MaxTokens == 0 {
		cr.MaxTokens = 4096
	}
	cr.SystemPrompt = "You are EncoreHub, a helpful AI assistant. Answer concisely and accurately. " +
			"You have access to real-time web search (DuckDuckGo, Bing, Google) — when the user enables it via the globe icon in the chat input, search results are automatically fetched and injected below. If you see [Web Search Results] in the context, those results are already fetched — use them; do NOT claim you cannot search. If the user asks for real-time or up-to-date information but no search results are present, suggest they click the globe icon to enable it." + systemExtra

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
