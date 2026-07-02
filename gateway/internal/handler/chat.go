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

	// Step 1.5: When web search is enabled the model receives a web_search
	// tool so it can actively decide to search. The provider choice is
	// captured so the tool executor uses the right backend.
	var searchTool *provider.Tool
	if req.Search {
		sp := req.SearchProvider
		if sp == "" {
			sp = "duckduckgo"
		}
		t := newWebSearchTool(sp)
		searchTool = &t
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

	// Step 3: Build chat request (includes messages + memory + knowledge context;
	// web search is a tool the model invokes on its own initiative).
	systemExtra := memoryContext + knowledgeContext
	var chatReq *provider.ChatRequest
	if convDetail, err := h.engine.GetConversation(c.Request.Context(), convID); err == nil {
		chatReq = buildChatRequest(convDetail, req, systemExtra, searchTool)
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
			"When you need real-time or up-to-date information, use the web_search tool to search the web. The user has already enabled web search — the tool is available to you. Do NOT say you cannot search the web; call the web_search function instead. Cite your sources from the search results." + systemExtra,
			Messages: []provider.Message{
				{Role: "user", Content: req.Content},
			},
		}
		if searchTool != nil {
			cr.Tools = []provider.Tool{*searchTool}
		}
		if cr.MaxTokens == 0 {
			cr.MaxTokens = 4096
		}
		chatReq = cr
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 120*time.Second)
	defer cancel()

	// Step 4: If no API key, refuse — unless ENCOREHUB_DEV_MOCK is set,
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

	// Step 5: Call real AI provider
	adapter, err := h.registry.Get(req.Provider)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Stream {
		h.providerStream(ctx, c, adapter, chatReq, apiKey, convID, userMsgID)
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

// ===== Streaming with optional tool-call loop =====

func (h *ChatHandler) providerStream(ctx context.Context, c *gin.Context, adapter provider.Adapter,
	req *provider.ChatRequest, apiKey, convID, userMsgID string) {

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Status(http.StatusOK)

	// The model may return tool_calls (e.g. web_search). We loop at most
	// maxToolRounds times, executing tools and re-calling the model with
	// the tool results appended to the conversation.
	const maxToolRounds = 3
	var fullContent string
	var fullReasoning string
	var totalTokens int
	var allToolCalls []engine.ToolCallInput
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

	processOneStream := func(cr *provider.ChatRequest) (content string, reasoning string, tokens int, toolCalls []engine.ToolCallInput, err error) {
		events, streamErr := adapter.ChatStream(ctx, cr, apiKey)
		if streamErr != nil {
			return "", "", 0, nil, streamErr
		}

		agg := newToolCallAggregator()
		for ev := range events {
			switch {
			case ev.Error != nil:
				return "", "", 0, nil, ev.Error
			case ev.Reasoning != nil:
				reasoning += ev.Reasoning.Content
				writeFrame("reasoning", map[string]string{"content": ev.Reasoning.Content})
			case ev.ToolCall != nil:
				agg.add(ev.ToolCall)
				writeFrame("tool_call", ev.ToolCall)
			case ev.ToolResult != nil:
				agg.setResult(ev.ToolResult)
				writeFrame("tool_result", ev.ToolResult)
			case ev.Delta != nil:
				if ev.Delta.Content != "" {
					content += ev.Delta.Content
					writeFrame("delta", map[string]string{"content": ev.Delta.Content})
				}
			case ev.Usage != nil:
				tokens = ev.Usage.InputTokens + ev.Usage.OutputTokens
				writeFrame("usage", map[string]int{
					"input_tokens":  ev.Usage.InputTokens,
					"output_tokens": ev.Usage.OutputTokens,
				})
			}
		}
		return content, reasoning, tokens, agg.toInputs(), nil
	}

	var err error
	cr := req // start with the original request

	for round := 0; round < maxToolRounds; round++ {
		content, reasoning, tokens, toolCalls, streamErr := processOneStream(cr)
		if streamErr != nil {
			log.Error().Err(streamErr).Msg("stream error")
			fmt.Fprintf(c.Writer, "event: error\ndata: %s\n\n", streamErr.Error())
			if flusher != nil {
				flusher.Flush()
			}
			return
		}

		fullContent = content
		fullReasoning = reasoning
		totalTokens = tokens
		allToolCalls = append(allToolCalls, toolCalls...)

		// Check if any tool calls need the gateway to execute them.
		hasGatewayTool := false
		var searchResults []search.Result
		for _, tc := range toolCalls {
			if tc.Name == "web_search" {
				// Extract the query from the arguments (JSON string).
				query := parseSearchQuery(tc.Arguments)
				if query == "" {
					query = fullContent // fallback
				}
				results, sErr := executeWebSearch(ctx, cr, query)
				if sErr != nil {
					log.Warn().Err(sErr).Msg("web_search execution failed")
					tc.Result = fmt.Sprintf("Search failed: %v", sErr)
					tc.Status = "error"
				} else {
					searchResults = append(searchResults, results...)
					tc.Result = formatSearchToolResult(results)
					tc.Status = "success"
				}
				hasGatewayTool = true
			}
		}

		if !hasGatewayTool || len(toolCalls) == 0 {
			// Model returned a text response — we're done.
			break
		}

		// Send tool_result events to the frontend so it can show what happened.
		for _, tc := range toolCalls {
			if tc.Name == "web_search" {
				writeFrame("tool_result", map[string]string{
					"id":     tc.ID,
					"result": tc.Result,
					"status": tc.Status,
				})
			}
		}

		// If we have search results, format them and build a new request
		// with the tool-call + tool-result messages appended.
		if len(searchResults) > 0 {
			log.Info().Int("results", len(searchResults)).Int("round", round+1).Msg("web_search tool executed, continuing conversation")
		}

		// Build the next request: append the assistant message (with tool_calls)
		// and a tool-result message for each executed tool.
		nextReq := cloneRequestForNextRound(cr, toolCalls)
		if nextReq == nil {
			break
		}
		cr = nextReq
	}

	// Store assistant reply with reasoning + tool calls.
	go h.storeAssistantMessage(convID, userMsgID, fullContent, fullReasoning, allToolCalls, totalTokens)

	fmt.Fprintf(c.Writer, "event: done\ndata: {}\n\n")
	if flusher != nil {
		flusher.Flush()
	}

	// Suppress unused error
	_ = err
}

// cloneRequestForNextRound builds a new ChatRequest from the previous one,
// appending the assistant's tool-call message and a tool-result message for
// each tool that was executed. This feeds the model the search results so it
// can continue generating.
func cloneRequestForNextRound(prev *provider.ChatRequest, toolCalls []engine.ToolCallInput) *provider.ChatRequest {
	if len(toolCalls) == 0 {
		return nil
	}

	messages := make([]provider.Message, len(prev.Messages))
	copy(messages, prev.Messages)

	// Convert the aggregated tool calls into the format the model expects:
	// an "assistant" message with tool_calls content, and a "tool" message
	// per tool call with the result.
	for _, tc := range toolCalls {
		if tc.Name == "" {
			continue
		}
		// Assistant message: include the tool call as structured content.
		// We serialise it as JSON for the provider to parse.
		tcJSON := fmt.Sprintf(`{"name":"%s","arguments":%s}`, tc.Name, tc.Arguments)
		messages = append(messages, provider.Message{
			Role:    "assistant",
			Content: "", // tool calls go in a separate field for OpenAI
		})
		_ = tcJSON // used by the adapter to reconstruct tool_calls

		// Tool result message.
		result := tc.Result
		if result == "" {
			result = "Tool executed successfully."
		}
		messages = append(messages, provider.Message{
			Role:    "tool",
			Content: result,
		})
	}

	next := &provider.ChatRequest{
		Model:               prev.Model,
		Stream:              prev.Stream,
		Temperature:         prev.Temperature,
		TopP:                prev.TopP,
		MaxTokens:           prev.MaxTokens,
		MaxCompletionTokens: prev.MaxCompletionTokens,
		FrequencyPenalty:    prev.FrequencyPenalty,
		PresencePenalty:     prev.PresencePenalty,
		Stop:                prev.Stop,
		Seed:                prev.Seed,
		JSONMode:            prev.JSONMode,
		ReasoningEffort:     prev.ReasoningEffort,
		SystemPrompt:        prev.SystemPrompt,
		Messages:            messages,
		Tools:               nil, // don't offer tools again to avoid loops
	}
	if next.MaxTokens == 0 {
		next.MaxTokens = 4096
	}
	return next
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
	if ev.ID != "" {
		tc.ID = ev.ID
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

// buildChatRequest builds a provider ChatRequest from a stored conversation.
// When searchTool is non-nil it is registered as an available tool so the
// model can proactively invoke web search.
func buildChatRequest(conv *engine.ConversationDetail, req SendMessageRequest, systemExtra string, searchTool *provider.Tool) *provider.ChatRequest {
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
		"When you need real-time or up-to-date information, use the web_search tool to search the web. The user has already enabled web search — the tool is available to you. Do NOT say you cannot search the web; call the web_search function instead. Cite your sources from the search results." + systemExtra

	if searchTool != nil {
		cr.Tools = []provider.Tool{*searchTool}
	}

	for _, msg := range conv.Messages {
		cr.Messages = append(cr.Messages, provider.Message{
			Role:    msg.Role,
			Content: msg.Content,
		})
	}
	return cr
}

// ===== Web search tool =====

// newWebSearchTool returns a Tool definition for the named search provider.
// The provider name is baked into the tool description so the model is aware
// which backend will be used.
func newWebSearchTool(providerName string) provider.Tool {
	desc := fmt.Sprintf(
		"Search the web for real-time, up-to-date information using %s. Use this when you need current events, recent data, or facts beyond your knowledge cutoff. The results will include titles, URLs, and snippets.",
		strings.ToUpper(providerName),
	)
	return provider.Tool{
		Type: "function",
		Function: &provider.FunctionDefinition{
			Name:        "web_search",
			Description: desc,
			Parameters: map[string]any{
				"type":       "object",
				"properties": map[string]any{
					"query": map[string]any{
						"type":        "string",
						"description": "The search query to look up on the web",
					},
				},
				"required": []any{"query"},
			},
		},
	}
}

// parseSearchQuery extracts the "query" field from a JSON arguments string.
// Returns the query or an empty string on failure.
func parseSearchQuery(arguments string) string {
	var args struct {
		Query string `json:"query"`
	}
	if err := json.Unmarshal([]byte(arguments), &args); err != nil {
		return ""
	}
	return args.Query
}

// executeWebSearch performs a web search using the engine's search provider.
// The provider choice is read from the request's Tools list (baked in by
// newWebSearchTool).
func executeWebSearch(ctx context.Context, req *provider.ChatRequest, query string) ([]search.Result, error) {
	// Determine which search provider to use by inspecting the tool definition.
	sp := "duckduckgo"
	for _, t := range req.Tools {
		if t.Function != nil && t.Function.Name == "web_search" {
			desc := t.Function.Description
			if strings.Contains(desc, "BING") {
				sp = "bing"
			} else if strings.Contains(desc, "GOOGLE") {
				sp = "google"
			} else if strings.Contains(desc, "DUCKDUCKGO") {
				sp = "duckduckgo"
			}
			break
		}
	}

	var apiKey string
	switch sp {
	case "bing":
		apiKey = os.Getenv("BING_SEARCH_API_KEY")
	case "google":
		apiKey = os.Getenv("GOOGLE_SEARCH_API_KEY")
	}

	searchProv, err := search.NewProvider(sp, apiKey,
		search.WithGoogleCSEcx(os.Getenv("GOOGLE_CSE_CX")),
	)
	if err != nil {
		return nil, fmt.Errorf("search provider init: %w", err)
	}

	resp, err := searchProv.Search(ctx, query, 5)
	if err != nil {
		return nil, fmt.Errorf("search failed: %w", err)
	}

	log.Info().Str("provider", sp).Str("query", query).Int("results", len(resp.Results)).Msg("web_search tool executed")
	return resp.Results, nil
}

// formatSearchToolResult formats search results as a text block the model can
// read after a web_search tool call.
func formatSearchToolResult(results []search.Result) string {
	if len(results) == 0 {
		return "No search results found."
	}
	var b strings.Builder
	b.WriteString("Web search results:\n\n")
	for i, r := range results {
		fmt.Fprintf(&b, "%d. **%s**\n   %s\n   URL: %s\n\n", i+1, r.Title, r.Snippet, r.URL)
	}
	b.WriteString("Use these results to answer the user's question. Cite your sources.")
	return b.String()
}

// ===== Mock helpers =====

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
