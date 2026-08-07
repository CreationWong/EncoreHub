// Package anthropic implements the Anthropic (Claude) provider adapter.
//
// Uses direct HTTP calls to Anthropic's Messages API with the standard
// net/http client, translating SSE events to EncoreHub's unified format.
package anthropic

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	// Internal packages use EncoreHub's stable reverse-domain namespace.
	"com.0d000721.encorehub/gateway/internal/diagnostics"
	"com.0d000721.encorehub/gateway/internal/provider"
)

const anthropicBaseURL = "https://api.anthropic.com/v1"

// Adapter implements provider.Adapter for Anthropic.
type Adapter struct {
	httpClient *http.Client
	id         string
	baseURL    string
	models     []string
}

// New builds the default Anthropic adapter (id "anthropic", official endpoint).
func New() *Adapter {
	return &Adapter{
		httpClient: diagnostics.NewHTTPClient(0),
		id:         "anthropic",
		baseURL:    anthropicBaseURL,
	}
}

// NewFromProfile builds an Anthropic-protocol adapter from a profile, allowing
// a custom id, endpoint, and model list. An empty BaseURL falls back to the
// official endpoint.
func NewFromProfile(p provider.ProviderProfile) *Adapter {
	base := p.BaseURL
	if base == "" {
		base = anthropicBaseURL
	}
	base = provider.ResolveAPIBaseURL(provider.ProtocolAnthropic, base)
	return &Adapter{
		httpClient: diagnostics.NewHTTPClient(0),
		id:         p.ID,
		baseURL:    base,
		models:     p.Models,
	}
}

func (a *Adapter) ID() string {
	return a.id
}

// ===== Request/Response types for Anthropic Messages API =====

type anthropicMessage struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
}

// anthropicMessageContent represents the typed blocks required for native
// tool calls and results in the Messages API.
type anthropicMessageContent struct {
	Type      string                `json:"type"`
	Text      string                `json:"text,omitempty"`
	ID        string                `json:"id,omitempty"`
	Name      string                `json:"name,omitempty"`
	Input     map[string]any        `json:"input,omitempty"`
	ToolUseID string                `json:"tool_use_id,omitempty"`
	Content   string                `json:"content,omitempty"`
	Source    *anthropicImageSource `json:"source,omitempty"`
}

// anthropicImageSource is the Base64 image block accepted by Messages API.
type anthropicImageSource struct {
	Type      string `json:"type"`
	MediaType string `json:"media_type"`
	Data      string `json:"data"`
}

type anthropicToolDefinition struct {
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	InputSchema map[string]any `json:"input_schema"`
}

type anthropicThinking struct {
	Type         string `json:"type"` // "enabled", "disabled", "adaptive"
	BudgetTokens int    `json:"budget_tokens,omitempty"`
}

type anthropicReq struct {
	Model         string                    `json:"model"`
	Messages      []anthropicMessage        `json:"messages"`
	System        string                    `json:"system,omitempty"`
	MaxTokens     int                       `json:"max_tokens"`
	Temperature   float32                   `json:"temperature,omitempty"`
	TopP          float32                   `json:"top_p,omitempty"`
	TopK          int                       `json:"top_k,omitempty"`
	StopSequences []string                  `json:"stop_sequences,omitempty"`
	Stream        bool                      `json:"stream"`
	Thinking      *anthropicThinking        `json:"thinking,omitempty"`
	Tools         []anthropicToolDefinition `json:"tools,omitempty"`
}

type anthropicContent struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type anthropicUsage struct {
	InputTokens              int `json:"input_tokens"`
	OutputTokens             int `json:"output_tokens"`
	CacheCreationInputTokens int `json:"cache_creation_input_tokens"`
	CacheReadInputTokens     int `json:"cache_read_input_tokens"`
}

type anthropicResp struct {
	ID           string             `json:"id"`
	Content      []anthropicContent `json:"content"`
	StopReason   string             `json:"stop_reason"`
	StopSequence string             `json:"stop_sequence"`
	Usage        anthropicUsage     `json:"usage"`
	Model        string             `json:"model"`
	Role         string             `json:"role"`
	Error        *struct {
		Type    string `json:"type"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

// SSE event types
type sseEvent struct {
	Type         string           `json:"type"`
	Index        int              `json:"index,omitempty"`
	Delta        *sseTextDelta    `json:"delta,omitempty"`
	ContentBlock *sseContentBlock `json:"content_block,omitempty"`
	Usage        *anthropicUsage  `json:"usage,omitempty"`
	Message      *struct {
		StopReason   string          `json:"stop_reason"`
		StopSequence string          `json:"stop_sequence"`
		Usage        *anthropicUsage `json:"usage,omitempty"`
	} `json:"message,omitempty"`
}

type sseTextDelta struct {
	Type        string `json:"type"`
	Text        string `json:"text"`         // text_delta
	Thinking    string `json:"thinking"`     // thinking_delta
	PartialJSON string `json:"partial_json"` // input_json_delta (tool args)
}

type sseContentBlock struct {
	Type string `json:"type"` // "text" | "thinking" | "tool_use"
	ID   string `json:"id"`
	Name string `json:"name"`
}

func (a *Adapter) Chat(ctx context.Context, req *provider.ChatRequest, apiKey string) (*provider.ChatResponse, error) {
	body := buildRequest(req, false)
	if body.MaxTokens == 0 {
		body.MaxTokens = 4096
	}

	resp, err := a.doRequest(ctx, "POST", "/messages", apiKey, body)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var ar anthropicResp
	if err := json.NewDecoder(resp.Body).Decode(&ar); err != nil {
		return nil, fmt.Errorf("anthropic decode: %w", err)
	}

	if ar.Error != nil {
		return nil, fmt.Errorf("anthropic error: %s - %s", ar.Error.Type, ar.Error.Message)
	}

	// Collect all text blocks (the first text block is the reply; thinking
	// blocks are the chain-of-thought, surfaced as Reasoning).
	content := ""
	for _, c := range ar.Content {
		if c.Type == "text" {
			content += c.Text
		}
	}

	// Anthropic reports cached prompt tokens separately from input_tokens even
	// though all three segments occupy the same context window.
	contextInputTokens := ar.Usage.InputTokens + ar.Usage.CacheCreationInputTokens + ar.Usage.CacheReadInputTokens
	return &provider.ChatResponse{
		Content:                  content,
		FinishReason:             ar.StopReason,
		InputTokens:              contextInputTokens,
		OutputTokens:             ar.Usage.OutputTokens,
		CacheCreationInputTokens: ar.Usage.CacheCreationInputTokens,
		CacheReadInputTokens:     ar.Usage.CacheReadInputTokens,
		Model:                    ar.Model,
	}, nil
}

func (a *Adapter) ChatStream(ctx context.Context, req *provider.ChatRequest, apiKey string) (<-chan provider.StreamEvent, error) {
	body := buildRequest(req, true)
	if body.MaxTokens == 0 {
		body.MaxTokens = 4096
	}

	resp, err := a.doRequest(ctx, "POST", "/messages", apiKey, body)
	if err != nil {
		return nil, err
	}

	events := make(chan provider.StreamEvent, 64)

	go func() {
		defer close(events)
		defer resp.Body.Close()

		scanner := bufio.NewScanner(resp.Body)
		for scanner.Scan() {
			for _, ev := range decodeStreamLine(scanner.Text()) {
				events <- ev
				if ev.Error != nil {
					return
				}
			}
		}
	}()

	return events, nil
}

// decodeStreamLine parses one SSE line from the Anthropic /messages stream
// and returns 0..N adapter events. Pure function, exposed for tests.
func decodeStreamLine(line string) []provider.StreamEvent {
	if !strings.HasPrefix(line, "data: ") {
		return nil
	}
	data := strings.TrimPrefix(line, "data: ")
	var ev sseEvent
	if err := json.Unmarshal([]byte(data), &ev); err != nil {
		return nil
	}

	switch ev.Type {
	case "content_block_start":
		// A tool_use block announces the tool id + name; its arguments stream
		// in later as input_json_delta on the same index.
		if ev.ContentBlock != nil && ev.ContentBlock.Type == "tool_use" {
			return []provider.StreamEvent{{
				ToolCall: &provider.ToolCallEvent{
					Index: ev.Index,
					ID:    ev.ContentBlock.ID,
					Name:  ev.ContentBlock.Name,
				},
			}}
		}
	case "content_block_stop":
		// Arguments are complete once their deltas end; forwarding a bare
		// block index would create an empty tool event for text and thinking.
		return nil
	case "content_block_delta":
		if ev.Delta == nil {
			return nil
		}
		switch ev.Delta.Type {
		case "text_delta":
			return []provider.StreamEvent{{
				Delta: &provider.DeltaEvent{Content: ev.Delta.Text},
			}}
		case "thinking_delta":
			return []provider.StreamEvent{{
				Reasoning: &provider.ReasoningEvent{Content: ev.Delta.Thinking},
			}}
		case "input_json_delta":
			return []provider.StreamEvent{{
				ToolCall: &provider.ToolCallEvent{
					Index:     ev.Index,
					Arguments: ev.Delta.PartialJSON,
				},
			}}
		}
	case "message_start":
		if ev.Message != nil && ev.Message.Usage != nil {
			usage := ev.Message.Usage
			return []provider.StreamEvent{{Usage: &provider.UsageEvent{
				InputTokens:              usage.InputTokens + usage.CacheCreationInputTokens + usage.CacheReadInputTokens,
				OutputTokens:             usage.OutputTokens,
				CacheCreationInputTokens: usage.CacheCreationInputTokens,
				CacheReadInputTokens:     usage.CacheReadInputTokens,
			}}}
		}
	case "message_delta":
		if ev.Usage != nil {
			contextInputTokens := ev.Usage.InputTokens + ev.Usage.CacheCreationInputTokens + ev.Usage.CacheReadInputTokens
			out := []provider.StreamEvent{{
				Usage: &provider.UsageEvent{
					InputTokens:              contextInputTokens,
					OutputTokens:             ev.Usage.OutputTokens,
					CacheCreationInputTokens: ev.Usage.CacheCreationInputTokens,
					CacheReadInputTokens:     ev.Usage.CacheReadInputTokens,
				},
			}}
			if ev.Message != nil && ev.Message.StopReason != "" {
				out = append(out, provider.StreamEvent{
					Delta: &provider.DeltaEvent{
						FinishReason: ev.Message.StopReason,
					},
				})
			}
			return out
		}
	case "message_stop":
		return []provider.StreamEvent{{
			Delta: &provider.DeltaEvent{FinishReason: "stop"},
		}}
	case "ping":
		// Heartbeat — no action needed.
		return nil
	case "error":
		return []provider.StreamEvent{{
			Error: fmt.Errorf("anthropic stream error: %s", data),
		}}
	}
	return nil
}

func (a *Adapter) ListModels(_ context.Context, _ string) ([]provider.ModelInfo, error) {
	// Anthropic doesn't have a list-models API. Prefer the profile's model
	// list when present (custom profiles), else fall back to known defaults.
	if len(a.models) > 0 {
		out := make([]provider.ModelInfo, 0, len(a.models))
		for _, m := range a.models {
			out = append(out, provider.ModelInfo{ID: m, Name: m, Provider: a.id, ContextLimit: 200000})
		}
		return out, nil
	}
	return []provider.ModelInfo{
		{ID: "claude-opus-4-8", Name: "Claude Opus 4.8", Provider: "anthropic", ContextLimit: 200000},
		{ID: "claude-sonnet-4-6", Name: "Claude Sonnet 4.6", Provider: "anthropic", ContextLimit: 200000},
		{ID: "claude-haiku-4-5-20251001", Name: "Claude Haiku 4.5", Provider: "anthropic", ContextLimit: 200000},
	}, nil
}

func (a *Adapter) ValidateKey(ctx context.Context, apiKey string) error {
	// Simple validation: try listing models
	_, err := a.ListModels(ctx, apiKey)
	return err
}

func buildRequest(req *provider.ChatRequest, stream bool) *anthropicReq {
	body := &anthropicReq{
		Model:         req.Model,
		MaxTokens:     req.MaxTokens,
		Temperature:   req.Temperature,
		TopP:          req.TopP,
		TopK:          req.TopK,
		StopSequences: req.Stop,
		Stream:        stream,
		System:        req.SystemPrompt,
		Messages:      make([]anthropicMessage, 0, len(req.Messages)),
	}

	// An explicit off state is required for compatible gateways that enable
	// reasoning by default; it takes precedence over a stale positive budget.
	if req.DisableReasoning {
		body.Thinking = &anthropicThinking{Type: "disabled"}
	} else if req.ThinkingBudget >= 1024 {
		body.Thinking = &anthropicThinking{
			Type:         "enabled",
			BudgetTokens: req.ThinkingBudget,
		}
	}
	for _, tool := range req.Tools {
		if tool.Function == nil {
			continue
		}
		schema := tool.Function.Parameters
		if schema == nil {
			schema = map[string]any{"type": "object"}
		}
		body.Tools = append(body.Tools, anthropicToolDefinition{
			Name: tool.Function.Name, Description: tool.Function.Description, InputSchema: schema,
		})
	}

	for messageIndex := 0; messageIndex < len(req.Messages); messageIndex++ {
		msg := req.Messages[messageIndex]
		role := msg.Role
		if role == "system" {
			// System messages become the top-level system field in Anthropic
			if body.System == "" {
				body.System = msg.Content
			}
			continue
		}
		if role == "assistant" && len(msg.ToolCalls) > 0 {
			blocks := make([]anthropicMessageContent, 0, len(msg.ToolCalls)+1)
			if msg.Content != "" {
				blocks = append(blocks, anthropicMessageContent{Type: "text", Text: msg.Content})
			}
			for _, toolCall := range msg.ToolCalls {
				input := make(map[string]any)
				if err := json.Unmarshal([]byte(toolCall.Arguments), &input); err != nil {
					input = map[string]any{}
				}
				blocks = append(blocks, anthropicMessageContent{
					Type: "tool_use", ID: toolCall.ID, Name: toolCall.Name, Input: input,
				})
			}
			body.Messages = append(body.Messages, anthropicMessage{Role: "assistant", Content: blocks})
			continue
		}
		if role == "tool" {
			// Anthropic requires every result for parallel tool_use blocks in one
			// immediately following user message. Separate user messages make all
			// but the first result appear missing to the provider.
			blocks := make([]anthropicMessageContent, 0, 1)
			for messageIndex < len(req.Messages) && req.Messages[messageIndex].Role == "tool" {
				toolMessage := req.Messages[messageIndex]
				blocks = append(blocks, anthropicMessageContent{
					Type: "tool_result", ToolUseID: toolMessage.ToolCallID, Content: toolMessage.Content,
				})
				messageIndex++
			}
			body.Messages = append(body.Messages, anthropicMessage{
				Role:    "user",
				Content: blocks,
			})
			messageIndex--
			continue
		}
		if len(msg.Parts) > 0 {
			blocks := make([]anthropicMessageContent, 0, len(msg.Parts))
			for _, part := range msg.Parts {
				if part.Type == "text" {
					blocks = append(blocks, anthropicMessageContent{Type: "text", Text: part.Text})
				} else if part.Type == "image" {
					data := part.Data
					if marker := strings.Index(data, ","); marker >= 0 {
						data = data[marker+1:]
					}
					blocks = append(blocks, anthropicMessageContent{Type: "image", Source: &anthropicImageSource{
						Type: "base64", MediaType: part.MediaType, Data: data,
					}})
				}
			}
			body.Messages = append(body.Messages, anthropicMessage{Role: role, Content: blocks})
			continue
		}
		body.Messages = append(body.Messages, anthropicMessage{
			Role:    role,
			Content: msg.Content,
		})
	}

	return body
}

func (a *Adapter) doRequest(ctx context.Context, method, path, apiKey string, body interface{}) (*http.Response, error) {
	jsonBody, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("anthropic marshal: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, method, a.baseURL+path, bytes.NewReader(jsonBody))
	if err != nil {
		return nil, fmt.Errorf("anthropic request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-api-key", apiKey)
	httpReq.Header.Set("anthropic-version", "2023-06-01")

	resp, err := a.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("anthropic http: %w", err)
	}

	if resp.StatusCode >= 400 {
		defer resp.Body.Close()
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("anthropic http %d: %s", resp.StatusCode, string(bodyBytes))
	}

	return resp, nil
}
