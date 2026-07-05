package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
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
	registry  *provider.Registry
	engine    *engine.Client
	titleMu   sync.Mutex
	titleJobs map[string]*titleJob
}

type titleResult struct {
	title   string
	changed bool
}

type titleJob struct {
	done   chan struct{}
	result titleResult
	err    error
}

func NewChatHandler(registry *provider.Registry, engineClient *engine.Client) *ChatHandler {
	return &ChatHandler{
		registry:  registry,
		engine:    engineClient,
		titleJobs: make(map[string]*titleJob),
	}
}

type SendMessageRequest struct {
	Content             string   `json:"content" binding:"required"`
	Provider            string   `json:"provider"`
	Model               string   `json:"model"`
	Stream              bool     `json:"stream"`
	Search              bool     `json:"search"`
	SearchProvider      string   `json:"search_provider"` // "duckduckgo" | "bing" | "google"
	Temperature         float32  `json:"temperature"`
	TopP                float32  `json:"top_p"`
	MaxTokens           int      `json:"max_tokens"`
	MaxCompletionTokens int      `json:"max_completion_tokens"`
	FrequencyPenalty    float32  `json:"frequency_penalty"`
	PresencePenalty     float32  `json:"presence_penalty"`
	Stop                []string `json:"stop"`
	Seed                *int     `json:"seed"`
	JSONMode            bool     `json:"json_mode"`
	ReasoningEffort     string   `json:"reasoning_effort"`
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

	// Step 1.5: Register tools for the model to use
	var searchTool, titleTool *provider.Tool

	// Web search tool
	if req.Search {
		sp := req.SearchProvider
		if sp == "" {
			sp = "duckduckgo"
		}
		t := newWebSearchTool(sp)
		searchTool = &t
	}

	// Title update tool - enable for conversations with multiple messages
	if convDetail, err := h.engine.GetConversation(c.Request.Context(), convID); err == nil {
		if len(convDetail.Messages) >= 3 {
			t := newTitleUpdateTool(req.Provider)
			titleTool = &t
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

	// Step 3: Build chat request (includes messages + memory + knowledge context;
	// web search is a tool the model invokes on its own initiative).
	systemExtra := memoryContext + knowledgeContext
	var chatReq *provider.ChatRequest
	if convDetail, err := h.engine.GetConversation(c.Request.Context(), convID); err == nil {
		chatReq = buildChatRequest(convDetail, req, systemExtra, searchTool, titleTool)
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

	ctx, cancel := context.WithTimeout(c.Request.Context(), 115*time.Second)
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

	// Non-streaming — fire AI-refined title concurrently (best-effort, only once).
	go func() {
		h.generateTitle(context.Background(), convID, req.Provider, req.Model, apiKey)
	}()

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

	// SSE writes are shared between the streaming loop and the concurrent
	// title goroutine — guard them with a mutex. `closed` is set once `done`
	// is emitted so late title results skip the write.
	var (
		writeMu sync.Mutex
		closed  bool
	)
	writeFrame := func(event string, payload any) {
		data, err := json.Marshal(payload)
		if err != nil {
			return
		}
		writeMu.Lock()
		defer writeMu.Unlock()
		if closed && event != "done" {
			return
		}
		fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", event, data)
		if flusher != nil {
			flusher.Flush()
		}
	}

	processOneStream := func(cr *provider.ChatRequest, round int) (content string, reasoning string, tokens int, toolCalls []engine.ToolCallInput, err error) {
		// Debug: log the full request for the follow-up round so we can
		// verify tool_call_id and tool_calls are serialised correctly.
		if round > 0 {
			if b, e := json.Marshal(cr); e == nil {
				log.Info().Int("round", round).Str("request", string(b)).Msg("tool-loop follow-up request")
			}
		}
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

	// AI-refined title (runs concurrently with streaming).
	type asyncTitleResult struct {
		result titleResult
		err    error
	}
	titleDone := make(chan asyncTitleResult, 1)
	go func() {
		titleCtx, cancel := context.WithTimeout(context.Background(), titleGenerationTimeout)
		defer cancel()
		result, err := h.generateTitleSync(titleCtx, convID, adapter.ID(), req.Model, apiKey, false)
		titleDone <- asyncTitleResult{result: result, err: err}
	}()

	writeTitleResult := func(res asyncTitleResult) {
		if res.err != nil {
			writeFrame("title_error", map[string]string{"message": "Failed to generate title"})
			return
		}
		if !res.result.changed {
			return
		}
		writeFrame("title_update", map[string]string{
			"conversation_id": convID,
			"title":           res.result.title,
		})
	}

	for round := 0; round < maxToolRounds; round++ {
		content, reasoning, tokens, toolCalls, streamErr := processOneStream(cr, round)
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
		for i := range toolCalls {
			tc := &toolCalls[i]
			if tc.Name == "web_search" {
				// Extract the query from the arguments (JSON string).
				query := parseSearchQuery(tc.Arguments)
				if query == "" {
					query = fullContent // fallback
				}
				results, warnMsg, sErr := executeWebSearch(ctx, cr, query)
				if sErr != nil {
					log.Warn().Err(sErr).Msg("web_search execution failed")
					tc.Result = fmt.Sprintf("Search failed: %v", sErr)
					tc.Status = "error"
				} else {
					if warnMsg != "" {
						writeFrame("warning", map[string]string{"message": warnMsg})
					}
					searchResults = append(searchResults, results...)
					tc.Result = formatSearchToolResult(results)
					tc.Status = "success"
				}
				hasGatewayTool = true
			}
		}

		// Handle title update tool calls
		for i := range toolCalls {
			tc := &toolCalls[i]
			if tc.Name == "update_conversation_title" {
				// Parse title from JSON arguments
				var args struct {
					Title string `json:"title"`
				}
				if err := json.Unmarshal([]byte(tc.Arguments), &args); err == nil {
					title := strings.TrimSpace(args.Title)
					if title != "" {
						// Execute title update
						if err := h.executeTitleUpdate(ctx, c, convID, title); err != nil {
							log.Warn().Err(err).Str("conv_id", convID).Msg("title update failed")
							tc.Result = fmt.Sprintf("Title update failed: %v", err)
							tc.Status = "error"
						} else {
							tc.Result = fmt.Sprintf("Title updated to: %s", title)
							tc.Status = "success"
						}
						hasGatewayTool = true
					}
				}
			}
		}

		if !hasGatewayTool || len(toolCalls) == 0 {
			// Model returned a text response — we're done.
			break
		}

		// Send tool_result events to the frontend so it can show what happened.
		for i := range toolCalls {
			tc := &toolCalls[i]
			if tc.Name == "web_search" {
				writeFrame("tool_result", map[string]string{
					"id":     tc.ID,
					"result": tc.Result,
					"status": tc.Status,
				})
			} else if tc.Name == "update_conversation_title" {
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

	// Store assistant message (fire-and-forget).
	go h.storeAssistantMessage(convID, userMsgID, fullContent, fullReasoning, allToolCalls, totalTokens)

	// Emit any hidden automatic-title result before done. The title request has
	// its own 30s timeout and ran in parallel with the visible chat stream.
	select {
	case res := <-titleDone:
		writeTitleResult(res)
	case <-ctx.Done():
		writeFrame("title_error", map[string]string{"message": "Failed to generate title"})
	}

	// Emit done.
	writeMu.Lock()
	closed = true
	fmt.Fprintf(c.Writer, "event: done\ndata: {}\n\n")
	if flusher != nil {
		flusher.Flush()
	}
	writeMu.Unlock()

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

	// Build a single assistant message carrying all tool calls, then one tool
	// result message per call. OpenAI / DeepSeek require:
	//   assistant: {role:"assistant", content:null, tool_calls:[{id,function:{name,arguments}}]}
	//   tool:      {role:"tool", tool_call_id:"<id>", content:"<result>"}
	var tcms []provider.ToolCallMessage
	for _, tc := range toolCalls {
		if tc.Name == "" {
			continue
		}
		tcms = append(tcms, provider.ToolCallMessage{
			ID:        tc.ID,
			Name:      tc.Name,
			Arguments: tc.Arguments,
		})
	}

	if len(tcms) > 0 {
		messages = append(messages, provider.Message{
			Role:      "assistant",
			Content:   "",
			ToolCalls: tcms,
		})
	}

	for _, tc := range toolCalls {
		if tc.Name == "" {
			continue
		}
		result := tc.Result
		if result == "" {
			result = "Tool executed successfully."
		}
		messages = append(messages, provider.Message{
			Role:       "tool",
			Content:    result,
			ToolCallID: tc.ID,
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
		// Some providers (including DeepSeek streaming) may not include
		// the tool call id in every delta chunk. Generate a synthetic
		// one so the follow-up request always has a valid tool_call_id.
		id := ev.ID
		if id == "" {
			id = fmt.Sprintf("call_%d", ev.Index)
		}
		tc = &engine.ToolCallInput{ID: id, Status: "pending"}
		a.calls[ev.Index] = tc
		a.order = append(a.order, ev.Index)
	}
	if ev.Name != "" {
		tc.Name = ev.Name
	}
	// Prefer an explicit ID from a later chunk over the synthetic one.
	if ev.ID != "" && ev.ID != tc.ID {
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
// When searchTool or titleTool are non-nil they are registered as available tools.
func buildChatRequest(conv *engine.ConversationDetail, req SendMessageRequest, systemExtra string, searchTool, titleTool *provider.Tool) *provider.ChatRequest {
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

	// Register available tools
	var tools []provider.Tool
	if searchTool != nil {
		tools = append(tools, *searchTool)
	}
	if titleTool != nil {
		tools = append(tools, *titleTool)
	}
	cr.Tools = tools

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
				"type": "object",
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
func executeWebSearch(ctx context.Context, req *provider.ChatRequest, query string) (results []search.Result, warning string, err error) {
	// Determine which search provider the user selected by inspecting the
	// tool description (set by newWebSearchTool).
	sp := "duckduckgo"
	for _, t := range req.Tools {
		if t.Function != nil && t.Function.Name == "web_search" {
			desc := t.Function.Description
			if strings.Contains(desc, "BING") {
				sp = "bing"
			} else if strings.Contains(desc, "GOOGLE") {
				sp = "google"
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

	searchProv, provErr := search.NewProvider(sp, apiKey,
		search.WithGoogleCSEcx(os.Getenv("GOOGLE_CSE_CX")),
	)
	if provErr != nil {
		// If the user picked Bing/Google but no API key is configured, fall
		// back to DuckDuckGo and return a warning for the frontend.
		log.Warn().Err(provErr).Str("fallback", "duckduckgo").Msg("web_search provider unavailable, falling back to DuckDuckGo")
		searchProv = search.NewDuckDuckGo()
		warning = fmt.Sprintf("Search provider %q is not configured (missing API key). Using DuckDuckGo instead.", sp)
	}

	resp, err := searchProv.Search(ctx, query, 5)
	if err != nil {
		return nil, "", fmt.Errorf("search failed: %w", err)
	}

	log.Info().Str("provider", searchProv.Name()).Str("query", query).Int("results", len(resp.Results)).Msg("web_search tool executed")
	return resp.Results, warning, nil
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

// ===== Title generation =====

// titleGenPrompt is the system prompt used to generate conversation titles.
// Goal: let the user recognize the conversation at a glance with the fewest
// possible characters — a topic keyword/phrase, never a full sentence.
const defaultConversationTitle = "New Chat"
const titleGenerationTimeout = 30 * time.Second

const titleGenPrompt = "Return only a concise topic title for the user's text. Do not mention this request, the instruction, chat, conversation, title generation, or summarization. Prefer concrete nouns from the text. Limits: Chinese-only <=20 Chinese characters; English-only <=15 words; mixed Chinese/English <=15 characters."

// generateTitleWithRetry calls the AI provider (non-streaming, reasoning
// disabled) to produce a title from the first user message. It retries up to
// 3 times when the provider errors or the cleaned result is empty. The caller
// owns the context timeout.
func (h *ChatHandler) generateTitleWithRetry(ctx context.Context, convID string, adapter provider.Adapter, model, apiKey, firstUserMsg string) (string, error) {
	sourceMsg := buildTitleSourceMessage(firstUserMsg)
	// Build request once — non-streaming, no reasoning/thinking for fast title generation.
	titleReq := &provider.ChatRequest{
		Model:               model,
		Stream:              false,
		MaxCompletionTokens: 80,
		Temperature:         0.3,
		SystemPrompt:        titleGenPrompt,
		DisableReasoning:    true,
		Messages: []provider.Message{
			{Role: "user", Content: sourceMsg},
		},
	}

	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		chatResp, err := adapter.Chat(ctx, titleReq, apiKey)
		if err != nil {
			lastErr = err
			log.Error().
				Err(err).
				Str("conv_id", convID).
				Str("provider", adapter.ID()).
				Str("model", model).
				Int("attempt", attempt+1).
				Interface("request", titleReq).
				Msg("title generation API call failed")
			if ctx.Err() != nil {
				return "", ctx.Err()
			}
			continue
		}
		raw, title := titleFromProviderResponse(chatResp)
		if title != "" {
			return title, nil
		}
		lastErr = fmt.Errorf("empty title from provider")
		log.Error().
			Str("conv_id", convID).
			Str("provider", adapter.ID()).
			Str("model", model).
			Int("attempt", attempt+1).
			Interface("request", titleReq).
			Interface("response", chatResp).
			Str("raw", raw).
			Msg("title generation returned empty or meta title")
	}
	if lastErr != nil {
		if fallback := fallbackTitleFromSource(sourceMsg); fallback != "" {
			return fallback, nil
		}
		return "", fmt.Errorf("title generation failed after 3 attempts: %w", lastErr)
	}
	if fallback := fallbackTitleFromSource(sourceMsg); fallback != "" {
		return fallback, nil
	}
	return "", fmt.Errorf("title generation failed after 3 attempts")
}

func titleFromProviderResponse(resp *provider.ChatResponse) (string, string) {
	if resp == nil {
		return "", ""
	}
	if title := validGeneratedTitle(resp.Content); title != "" {
		return resp.Content, title
	}
	return resp.Content, ""
}

func validGeneratedTitle(raw string) string {
	title := cleanGeneratedTitle(raw)
	if isBadGeneratedTitle(title) {
		return ""
	}
	return title
}

func fallbackTitleFromSource(source string) string {
	compact := strings.ToLower(source)
	switch {
	case strings.Contains(source, "域名系统") && strings.Contains(compact, "dns"):
		return "域名系统 DNS"
	case strings.Contains(source, "域名系统"):
		return "域名系统"
	case strings.Contains(compact, "domain name system") || strings.Contains(compact, "dns"):
		return "DNS"
	default:
		return ""
	}
}

func buildTitleSourceMessage(firstUserMsg string) string {
	return stripLeadingTitleTask(firstUserMsg)
}

func stripLeadingTitleTask(s string) string {
	text := strings.TrimSpace(s)
	lower := strings.ToLower(text)
	for _, prefix := range []string{
		"请给下面内容生成一个标题",
		"请给下面内容生成标题",
		"请给下面这段话生成一个标题",
		"请给下面这段话生成标题",
		"请给这段话生成一个标题",
		"请给这段话生成标题",
		"给下面内容生成一个标题",
		"给下面内容生成标题",
		"给这段话生成一个标题",
		"给这段话生成标题",
		"请起一个标题",
		"请起个标题",
		"起一个标题",
		"起个标题",
		"请总结一下",
		"请总结下",
		"请总结",
		"请帮我总结一下",
		"请帮我总结下",
		"请帮我总结",
		"帮我总结一下",
		"帮我总结下",
		"帮我总结",
		"总结一下",
		"总结下",
		"总结",
		"summarize the following",
		"summarize this",
		"summarize",
	} {
		if strings.HasPrefix(lower, strings.ToLower(prefix)) {
			return strings.TrimLeft(strings.TrimSpace(text[len(prefix):]), "：:，,。.\r\n\t ")
		}
	}
	return text
}

func isBadGeneratedTitle(title string) bool {
	compact := strings.ToLower(strings.ReplaceAll(title, " ", ""))
	if compact == "" {
		return true
	}
	for _, bad := range []string{
		"我们被要求",
		"被要求为",
		"给定的源消息",
		"源消息",
		"生成标题",
		"对话标题",
		"简短标题",
		"标题生成",
		"sourcemessage",
		"givenmessage",
		"given source",
		"conversationtitle",
		"generatetitle",
		"shorttitle",
	} {
		if strings.Contains(compact, bad) {
			return true
		}
	}
	return false
}

// generateTitle calls the AI provider in a background goroutine to produce a
// short title from the first user message. Retries up to 3 times; fails silently.
func (h *ChatHandler) generateTitle(ctx context.Context, convID, providerName, model, apiKey string) {
	if ctx == nil {
		ctx = context.Background()
	}
	titleCtx, cancel := context.WithTimeout(ctx, titleGenerationTimeout)
	defer cancel()
	if _, err := h.generateTitleSync(titleCtx, convID, providerName, model, apiKey, false); err != nil {
		log.Debug().Err(err).Str("conv_id", convID).Msg("auto-title generation failed")
	}
}

// newTitleUpdateTool creates a tool for updating conversation titles.
func newTitleUpdateTool(providerName string) provider.Tool {
	return provider.Tool{
		Type: "function",
		Function: &provider.FunctionDefinition{
			Name:        "update_conversation_title",
			Description: fmt.Sprintf("Update the title of this conversation using %s. Use this only when the user asks to rename or retitle the conversation, or when the conversation topic clearly changed. The title must be concise: Chinese-only <=20 Chinese characters, English-only <=15 words, mixed Chinese/English <=15 characters.", strings.ToUpper(providerName)),
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"title": map[string]any{
						"type":        "string",
						"description": "The new concise title for the conversation",
					},
				},
				"required": []any{"title"},
			},
		},
	}
}

// executeTitleUpdate handles the execution of a title update tool call.
func (h *ChatHandler) executeTitleUpdate(ctx context.Context, c *gin.Context, convID, title string) error {
	title = cleanGeneratedTitle(title)
	if title == "" {
		return fmt.Errorf("title cannot be empty")
	}

	// Update conversation title via engine
	if _, err := h.engine.RenameConversation(ctx, convID, title); err != nil {
		return fmt.Errorf("failed to update title: %w", err)
	}

	// Send title update via SSE for real-time UI update
	c.SSEvent("title_update", map[string]string{
		"conversation_id": convID,
		"title":           title,
	})

	return nil
}

// cleanGeneratedTitle strips formatting noise from an AI-generated title.
func cleanGeneratedTitle(raw string) string {
	title := strings.TrimSpace(raw)

	// Extract first line (models sometimes append commentary).
	if idx := strings.IndexByte(title, '\n'); idx != -1 {
		title = strings.TrimSpace(title[:idx])
	}

	// Strip common prefixes models sometimes emit.
	for _, prefix := range []string{
		"Title:", "title:", "标题：", "标题:",
		"Here is a title:", "Sure,",
	} {
		if after, ok := strings.CutPrefix(title, prefix); ok {
			title = strings.TrimSpace(after)
			break
		}
	}

	// Strip balanced surrounding quotes / brackets / asterisks.
	for {
		next := stripBalancedWrappers(title)
		if next == title {
			break
		}
		title = strings.TrimSpace(next)
	}

	// Strip leading/trailing punctuation and whitespace (including full-width).
	title = strings.Trim(title, "\"'`*#_-–—：:！!？?。.、,，… \t\r\n")

	title = strings.TrimSpace(title)

	return limitGeneratedTitle(title)
}

// truncateRunes truncates s to at most max runes without splitting multi-byte characters.
func truncateRunes(s string, max int) string {
	rs := []rune(s)
	if len(rs) <= max {
		return s
	}
	return string(rs[:max])
}

// stripBalanced removes c from both ends of s when both ends have it.
func stripBalanced(s string, c rune) string {
	rs := []rune(s)
	if len(rs) < 2 {
		return s
	}
	if rs[0] == c && rs[len(rs)-1] == c {
		return strings.TrimSpace(string(rs[1 : len(rs)-1]))
	}
	return s
}

func stripBalancedPair(s string, open, close rune) string {
	rs := []rune(s)
	if len(rs) < 2 {
		return s
	}
	if rs[0] == open && rs[len(rs)-1] == close {
		return strings.TrimSpace(string(rs[1 : len(rs)-1]))
	}
	return s
}

func stripBalancedWrappers(s string) string {
	for _, c := range []rune{'"', '\'', '`', '*'} {
		if next := stripBalanced(s, c); next != s {
			return next
		}
	}
	for _, pair := range [][2]rune{
		{'「', '」'},
		{'『', '』'},
		{'【', '】'},
		{'《', '》'},
		{'(', ')'},
		{'（', '）'},
		{'[', ']'},
		{'{', '}'},
	} {
		if next := stripBalancedPair(s, pair[0], pair[1]); next != s {
			return next
		}
	}
	return s
}

func limitGeneratedTitle(title string) string {
	if title == "" {
		return ""
	}
	hasCJK := containsCJK(title)
	hasLatin := containsLatin(title)
	if hasCJK && hasLatin {
		return truncateRunes(title, 15)
	}
	if hasCJK {
		return truncateRunes(title, 20)
	}
	words := strings.Fields(title)
	if len(words) > 15 {
		title = strings.Join(words[:15], " ")
	}
	return truncateRunes(title, 100)
}

func containsCJK(s string) bool {
	for _, r := range s {
		if (r >= '\u4e00' && r <= '\u9fff') ||
			(r >= '\u3400' && r <= '\u4dbf') ||
			(r >= '\uf900' && r <= '\ufaff') {
			return true
		}
	}
	return false
}

func containsLatin(s string) bool {
	for _, r := range s {
		if (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') {
			return true
		}
	}
	return false
}

// generateTitleSync calls the AI provider (non-streaming, reasoning disabled) to
// produce a short title from the first user message, then persists it. Automatic
// calls are idempotent: they only rename conversations that still use the
// default title, and concurrent automatic requests share one in-flight job.
func (h *ChatHandler) generateTitleSync(ctx context.Context, convID, providerName, model, apiKey string, force bool) (titleResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if force {
		return h.generateTitleForConversation(ctx, convID, providerName, model, apiKey, true)
	}

	h.titleMu.Lock()
	if job, ok := h.titleJobs[convID]; ok {
		h.titleMu.Unlock()
		select {
		case <-job.done:
			return job.result, job.err
		case <-ctx.Done():
			return titleResult{}, ctx.Err()
		}
	}
	job := &titleJob{done: make(chan struct{})}
	h.titleJobs[convID] = job
	h.titleMu.Unlock()

	job.result, job.err = h.generateTitleForConversation(ctx, convID, providerName, model, apiKey, false)
	close(job.done)

	h.titleMu.Lock()
	delete(h.titleJobs, convID)
	h.titleMu.Unlock()

	return job.result, job.err
}

func (h *ChatHandler) generateTitleForConversation(ctx context.Context, convID, providerName, model, apiKey string, force bool) (titleResult, error) {
	conv, err := h.engine.GetConversation(ctx, convID)
	if err != nil {
		return titleResult{}, err
	}
	if !force && strings.TrimSpace(conv.Title) != defaultConversationTitle {
		return titleResult{title: conv.Title, changed: false}, nil
	}
	// Find the first user message.
	var firstUserMsg string
	for _, msg := range conv.Messages {
		if msg.Role == "user" {
			firstUserMsg = msg.Content
			break
		}
	}
	if firstUserMsg == "" {
		return titleResult{}, fmt.Errorf("no user messages found")
	}

	adapter, err := h.registry.Get(providerName)
	if err != nil {
		return titleResult{}, err
	}

	title, err := h.generateTitleWithRetry(ctx, convID, adapter, model, apiKey, firstUserMsg)
	if err != nil {
		return titleResult{}, err
	}

	// The user may have renamed the conversation while the title API call was
	// in flight. Automatic generation must not overwrite that newer title.
	if !force {
		latest, err := h.engine.GetConversation(ctx, convID)
		if err != nil {
			return titleResult{}, err
		}
		if strings.TrimSpace(latest.Title) != defaultConversationTitle {
			return titleResult{title: latest.Title, changed: false}, nil
		}
	}

	renamed, err := h.engine.RenameConversation(ctx, convID, title)
	if err != nil {
		return titleResult{}, err
	}

	return titleResult{title: renamed.Title, changed: true}, nil
}

type GenerateTitleRequest struct {
	Force bool `json:"force"`
}

// GenerateTitle handles POST /api/v1/conversations/:id/generate-title.
// It uses the conversation's AI provider to produce a title (non-streaming,
// reasoning disabled) from the first user message. Retries up to 3 times.
func (h *ChatHandler) GenerateTitle(c *gin.Context) {
	convID := c.Param("id")
	var req GenerateTitleRequest
	if err := json.NewDecoder(c.Request.Body).Decode(&req); err != nil && err != io.EOF {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	conv, err := h.engine.GetConversation(c.Request.Context(), convID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "conversation not found"})
		return
	}
	if !req.Force && strings.TrimSpace(conv.Title) != defaultConversationTitle {
		c.JSON(http.StatusOK, conversationFromDetail(conv))
		return
	}

	providerName := conv.Provider
	model := conv.Model
	if providerName == "" {
		providerName = "openai"
	}
	if model == "" {
		model = "gpt-4o"
	}

	apiKey := c.GetHeader("X-Provider-Key")
	if apiKey == "" {
		apiKey = c.GetHeader("X-" + providerName + "-Key")
	}
	if apiKey == "" {
		if k, found, engineErr := h.engine.GetSecret(c.Request.Context(), providerName); engineErr != nil {
			log.Debug().Err(engineErr).Msg("engine secret lookup failed (non-fatal)")
		} else if found {
			apiKey = k
		}
	}
	if apiKey == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "missing provider API key"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), titleGenerationTimeout)
	defer cancel()

	result, err := h.generateTitleSync(ctx, convID, providerName, model, apiKey, req.Force)
	if err != nil {
		status := http.StatusInternalServerError
		if strings.Contains(err.Error(), "no user messages") ||
			strings.Contains(err.Error(), "unknown provider") {
			status = http.StatusBadRequest
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	latest, err := h.engine.GetConversation(ctx, convID)
	if err == nil {
		c.JSON(http.StatusOK, conversationFromDetail(latest))
		return
	}

	c.JSON(http.StatusOK, engine.Conversation{
		ID:           convID,
		Title:        result.title,
		Provider:     providerName,
		Model:        model,
		MessageCount: len(conv.Messages),
		CreatedAt:    conv.CreatedAt,
		UpdatedAt:    conv.UpdatedAt,
	})
}

func conversationFromDetail(conv *engine.ConversationDetail) engine.Conversation {
	return engine.Conversation{
		ID:           conv.ID,
		Title:        conv.Title,
		Provider:     conv.Provider,
		Model:        conv.Model,
		MessageCount: len(conv.Messages),
		CreatedAt:    conv.CreatedAt,
		UpdatedAt:    conv.UpdatedAt,
	}
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
