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

	"github.com/encorehub/gateway/internal/provider"
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
		httpClient: &http.Client{},
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
	return &Adapter{
		httpClient: &http.Client{},
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
	Content string `json:"content"`
}

type anthropicReq struct {
	Model       string             `json:"model"`
	Messages    []anthropicMessage `json:"messages"`
	System      string             `json:"system,omitempty"`
	MaxTokens   int                `json:"max_tokens"`
	Temperature float32            `json:"temperature,omitempty"`
	Stream      bool               `json:"stream"`
}

type anthropicContent struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type anthropicUsage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
}

type anthropicResp struct {
	Content    []anthropicContent `json:"content"`
	StopReason string             `json:"stop_reason"`
	Usage      anthropicUsage     `json:"usage"`
	Model      string             `json:"model"`
	Error      *struct {
		Type    string `json:"type"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

// SSE event types
type sseEvent struct {
	Type    string          `json:"type"`
	Delta   *sseTextDelta   `json:"delta,omitempty"`
	Usage   *anthropicUsage `json:"usage,omitempty"`
	Message *struct {
		StopReason string `json:"stop_reason"`
	} `json:"message,omitempty"`
}

type sseTextDelta struct {
	Type string `json:"type"`
	Text string `json:"text"`
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

	content := ""
	if len(ar.Content) > 0 {
		content = ar.Content[0].Text
	}

	return &provider.ChatResponse{
		Content:      content,
		FinishReason: ar.StopReason,
		InputTokens:  ar.Usage.InputTokens,
		OutputTokens: ar.Usage.OutputTokens,
		Model:        ar.Model,
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
	case "content_block_delta":
		if ev.Delta != nil && ev.Delta.Type == "text_delta" {
			return []provider.StreamEvent{{
				Delta: &provider.DeltaEvent{Content: ev.Delta.Text},
			}}
		}
	case "message_delta":
		if ev.Usage != nil {
			return []provider.StreamEvent{{
				Usage: &provider.UsageEvent{
					InputTokens:  ev.Usage.InputTokens,
					OutputTokens: ev.Usage.OutputTokens,
				},
			}}
		}
	case "message_stop":
		return []provider.StreamEvent{{
			Delta: &provider.DeltaEvent{FinishReason: "stop"},
		}}
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
		Model:       req.Model,
		MaxTokens:   req.MaxTokens,
		Temperature: req.Temperature,
		Stream:      stream,
		System:      req.SystemPrompt,
		Messages:    make([]anthropicMessage, 0, len(req.Messages)),
	}

	for _, msg := range req.Messages {
		role := msg.Role
		if role == "system" {
			// System messages become the top-level system field in Anthropic
			if body.System == "" {
				body.System = msg.Content
			}
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
