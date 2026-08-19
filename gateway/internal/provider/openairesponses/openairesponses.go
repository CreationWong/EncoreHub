// Package openairesponses implements OpenAI's Responses API wire format.
// It is intentionally separate from openaicompat: both APIs use the same
// authentication and /v1 namespace, but their request and streaming schemas
// are not interchangeable.
package openairesponses

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"com.0d000721.encorehub/gateway/internal/diagnostics"
	"com.0d000721.encorehub/gateway/internal/provider"
)

const officialBaseURL = "https://api.openai.com/v1"

// Adapter translates EncoreHub's unified chat contract to POST /responses.
type Adapter struct {
	id     string
	base   string
	models []string
}

// New builds a Responses API adapter from a persisted provider profile.
func New(p provider.ProviderProfile) *Adapter {
	base := provider.ResolveAPIBaseURL(provider.ProtocolOpenAIResponses, p.BaseURL)
	if base == "" {
		base = officialBaseURL
	}
	return &Adapter{id: p.ID, base: strings.TrimRight(base, "/"), models: append([]string(nil), p.Models...)}
}

func (a *Adapter) ID() string { return a.id }

type requestBody struct {
	Model           string            `json:"model"`
	Input           []map[string]any  `json:"input,omitempty"`
	Instructions    string            `json:"instructions,omitempty"`
	Stream          bool              `json:"stream,omitempty"`
	MaxOutputTokens int               `json:"max_output_tokens,omitempty"`
	Temperature     float32           `json:"temperature,omitempty"`
	TopP            float32           `json:"top_p,omitempty"`
	Reasoning       map[string]string `json:"reasoning,omitempty"`
	Text            map[string]any    `json:"text,omitempty"`
	Tools           []map[string]any  `json:"tools,omitempty"`
}

func (a *Adapter) buildRequest(req *provider.ChatRequest) requestBody {
	body := requestBody{Model: req.Model, Input: toInput(req), Stream: req.Stream, Temperature: req.Temperature, TopP: req.TopP}
	body.Instructions = instructions(req)
	if req.MaxTokens > 0 {
		body.MaxOutputTokens = req.MaxTokens
	} else if req.MaxCompletionTokens > 0 {
		body.MaxOutputTokens = req.MaxCompletionTokens
	}
	if req.ReasoningEffort != "" && !req.DisableReasoning {
		body.Reasoning = map[string]string{"effort": req.ReasoningEffort}
	}
	if req.JSONMode {
		body.Text = map[string]any{"format": map[string]any{"type": "json_object"}}
	}
	for _, tool := range req.Tools {
		if tool.Function == nil {
			continue
		}
		body.Tools = append(body.Tools, map[string]any{
			"type": "function", "name": tool.Function.Name,
			"description": tool.Function.Description, "parameters": tool.Function.Parameters,
			"strict": false,
		})
	}
	return body
}

func instructions(req *provider.ChatRequest) string {
	parts := make([]string, 0, 1)
	if strings.TrimSpace(req.SystemPrompt) != "" {
		parts = append(parts, req.SystemPrompt)
	}
	for _, msg := range req.Messages {
		if msg.Role == "system" && strings.TrimSpace(msg.Content) != "" {
			parts = append(parts, msg.Content)
		}
	}
	return strings.Join(parts, "\n\n")
}

func toInput(req *provider.ChatRequest) []map[string]any {
	input := make([]map[string]any, 0, len(req.Messages))
	for _, msg := range req.Messages {
		if msg.Role == "system" {
			continue
		}
		if msg.Role == "assistant" && len(msg.ToolCalls) > 0 {
			if msg.Content != "" {
				input = append(input, responseMessage("assistant", []map[string]any{{"type": "output_text", "text": msg.Content}}))
			}
			for _, call := range msg.ToolCalls {
				input = append(input, map[string]any{"type": "function_call", "call_id": call.ID, "name": call.Name, "arguments": call.Arguments})
			}
			continue
		}
		if msg.Role == "tool" {
			input = append(input, map[string]any{"type": "function_call_output", "call_id": msg.ToolCallID, "output": msg.Content})
			continue
		}
		role := msg.Role
		if role == "" {
			role = "user"
		}
		input = append(input, responseMessage(role, messageContent(msg)))
	}
	return input
}

func responseMessage(role string, content []map[string]any) map[string]any {
	return map[string]any{"type": "message", "role": role, "content": content}
}

func messageContent(msg provider.Message) []map[string]any {
	parts := msg.Parts
	if len(parts) == 0 {
		return []map[string]any{{"type": "input_text", "text": msg.Content}}
	}
	out := make([]map[string]any, 0, len(parts))
	for _, part := range parts {
		switch part.Type {
		case "image", "image_url":
			out = append(out, map[string]any{"type": "input_image", "image_url": part.Data, "detail": "auto"})
		default:
			text := part.Text
			if text == "" {
				text = part.Data
			}
			out = append(out, map[string]any{"type": "input_text", "text": text})
		}
	}
	return out
}

func (a *Adapter) do(ctx context.Context, method, path string, body any, apiKey string, stream bool) (*http.Response, error) {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("marshal request: %w", err)
		}
		reader = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, a.base+path, reader)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	if stream {
		req.Header.Set("Accept", "text/event-stream")
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
	client := diagnostics.NewHTTPClient(0)
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusBadRequest {
		resp.Body.Close()
		return nil, provider.NewUpstreamHTTPError(resp.StatusCode)
	}
	return resp, nil
}

// Usage contains token accounting returned by the Responses API.
type Usage struct {
	InputTokens        int `json:"input_tokens"`
	OutputTokens       int `json:"output_tokens"`
	InputTokensDetails struct {
		CachedTokens int `json:"cached_tokens"`
	} `json:"input_tokens_details"`
}

// OutputItem is one item in a Responses API output list.
type OutputItem struct {
	Type      string `json:"type"`
	Role      string `json:"role"`
	CallID    string `json:"call_id"`
	ItemID    string `json:"item_id"`
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
	Summary   []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"summary"`
	Content []struct {
		Type    string `json:"type"`
		Text    string `json:"text"`
		Summary []struct {
			Text string `json:"text"`
		} `json:"summary"`
	} `json:"content"`
}

type responseEnvelope struct {
	ID         string           `json:"id"`
	Model      string           `json:"model"`
	Status     string           `json:"status"`
	OutputText string           `json:"output_text"`
	Output     []OutputItem `json:"output"`
	Usage      Usage        `json:"usage"`
}

func (a *Adapter) Chat(ctx context.Context, req *provider.ChatRequest, apiKey string) (*provider.ChatResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("%s chat request is required", a.id)
	}
	if !modelConfigured(a.models, req.Model) {
		return nil, fmt.Errorf("%s model %q is not configured", a.id, req.Model)
	}
	body := a.buildRequest(req)
	body.Stream = false
	resp, err := a.do(ctx, http.MethodPost, "/responses", body, apiKey, false)
	if err != nil {
		return nil, fmt.Errorf("%s chat: %w", a.id, err)
	}
	defer resp.Body.Close()
	var wire responseEnvelope
	if err := json.NewDecoder(io.LimitReader(resp.Body, 32<<20)).Decode(&wire); err != nil {
		return nil, fmt.Errorf("%s response: %w", a.id, err)
	}
	content, reasoning := extractOutput(wire)
	if wire.OutputText != "" {
		content = wire.OutputText
	}
	return &provider.ChatResponse{Content: content, ReasoningContent: reasoning, FinishReason: finishReason(wire.Status), InputTokens: wire.Usage.InputTokens, OutputTokens: wire.Usage.OutputTokens, CacheReadInputTokens: wire.Usage.InputTokensDetails.CachedTokens, Model: wire.Model}, nil
}

func modelConfigured(models []string, id string) bool {
	for _, model := range models {
		if model == id {
			return true
		}
	}
	return false
}

func extractOutput(wire responseEnvelope) (string, string) {
	var content, reasoning strings.Builder
	for _, item := range wire.Output {
		for _, part := range item.Summary {
			reasoning.WriteString(part.Text)
		}
		for _, part := range item.Content {
			switch part.Type {
			case "output_text":
				content.WriteString(part.Text)
			case "summary_text":
				reasoning.WriteString(part.Text)
			default:
				for _, summary := range part.Summary {
					reasoning.WriteString(summary.Text)
				}
			}
		}
	}
	return content.String(), reasoning.String()
}

func finishReason(status string) string {
	switch status {
	case "completed":
		return "stop"
	case "cancelled":
		return "cancelled"
	case "failed":
		return "error"
	case "incomplete":
		return "length"
	default:
		return status
	}
}

func (a *Adapter) ChatStream(ctx context.Context, req *provider.ChatRequest, apiKey string) (<-chan provider.StreamEvent, error) {
	if req == nil {
		return nil, fmt.Errorf("%s stream request is required", a.id)
	}
	if !modelConfigured(a.models, req.Model) {
		return nil, fmt.Errorf("%s model %q is not configured", a.id, req.Model)
	}
	body := a.buildRequest(req)
	body.Stream = true
	resp, err := a.do(ctx, http.MethodPost, "/responses", body, apiKey, true)
	if err != nil {
		return nil, fmt.Errorf("%s stream: %w", a.id, err)
	}
	events := make(chan provider.StreamEvent, 64)
	go func() {
		defer close(events)
		defer resp.Body.Close()
		scanner := bufio.NewScanner(resp.Body)
		scanner.Buffer(make([]byte, 4096), 4<<20)
		var eventName, data string
		argumentDelta := make(map[int]bool)
		callKnown := make(map[int]bool)
		emit := func(name, raw string) {
			var event map[string]any
			if json.Unmarshal([]byte(raw), &event) != nil {
				return
			}
			switch name {
			case "response.output_item.added":
				item, _ := event["item"].(map[string]any)
				if stringValue(item["type"]) == "function_call" {
					index := intValue(event["output_index"])
					callKnown[index] = true
					events <- provider.StreamEvent{ToolCall: &provider.ToolCallEvent{Index: index, ID: firstString(item, "call_id", "id"), Name: stringValue(item["name"])}}
				}
			case "response.output_text.delta":
				if delta, _ := event["delta"].(string); delta != "" {
					events <- provider.StreamEvent{Delta: &provider.DeltaEvent{Content: delta}}
				}
			case "response.reasoning_summary_text.delta":
				if delta, _ := event["delta"].(string); delta != "" {
					events <- provider.StreamEvent{Reasoning: &provider.ReasoningEvent{Content: delta}}
				}
			case "response.function_call_arguments.delta":
				if delta, _ := event["delta"].(string); delta != "" {
					index := intValue(event["output_index"])
					argumentDelta[index] = true
					events <- provider.StreamEvent{ToolCall: &provider.ToolCallEvent{Index: index, Arguments: delta}}
				}
			case "response.function_call_arguments.done":
				index := intValue(event["output_index"])
				arguments := stringValue(event["arguments"])
				if argumentDelta[index] {
					arguments = ""
				}
				id := stringValue(event["call_id"])
				if id == "" && !callKnown[index] {
					id = stringValue(event["item_id"])
				}
				events <- provider.StreamEvent{ToolCall: &provider.ToolCallEvent{Index: index, ID: id, Name: stringValue(event["name"]), Arguments: arguments}}
			case "response.completed":
				var completed responseEnvelope
				if rawResponse, ok := event["response"]; ok {
					encoded, _ := json.Marshal(rawResponse)
					_ = json.Unmarshal(encoded, &completed)
				}
				events <- provider.StreamEvent{Usage: &provider.UsageEvent{InputTokens: completed.Usage.InputTokens, OutputTokens: completed.Usage.OutputTokens, CacheReadInputTokens: completed.Usage.InputTokensDetails.CachedTokens}}
				events <- provider.StreamEvent{Delta: &provider.DeltaEvent{FinishReason: finishReason(completed.Status)}}
			case "response.failed", "error":
				events <- provider.StreamEvent{Error: fmt.Errorf("%s response stream failed", a.id)}
			}
		}
		for scanner.Scan() {
			line := scanner.Text()
			if line == "" {
				if eventName != "" && data != "" {
					emit(eventName, data)
				}
				eventName, data = "", ""
				continue
			}
			if strings.HasPrefix(line, "event:") {
				eventName = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
			}
			if strings.HasPrefix(line, "data:") {
				data += strings.TrimSpace(strings.TrimPrefix(line, "data:"))
			}
		}
		if scanner.Err() != nil {
			events <- provider.StreamEvent{Error: fmt.Errorf("%s stream recv: %w", a.id, scanner.Err())}
		}
	}()
	return events, nil
}

func stringValue(value any) string { text, _ := value.(string); return text }
func intValue(value any) int {
	number, _ := value.(float64)
	return int(number)
}
func firstString(event map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := event[key].(string); ok && value != "" {
			return value
		}
	}
	return ""
}

func (a *Adapter) ListModels(_ context.Context, _ string) ([]provider.ModelInfo, error) {
	out := make([]provider.ModelInfo, 0, len(a.models))
	for _, model := range a.models {
		out = append(out, provider.ModelInfo{ID: model, Name: model, Provider: a.id})
	}
	return out, nil
}

func (a *Adapter) ValidateKey(ctx context.Context, apiKey string) error {
	resp, err := a.do(ctx, http.MethodGet, "/models", nil, apiKey, false)
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

// Client provides Responses lifecycle endpoints that are not part of the
// gateway's generic chat adapter contract.
type Client struct {
	base       string
	HTTPClient *http.Client
}

// NewClient creates a lifecycle client for an OpenAI Responses API base URL.
func NewClient(baseURL string, httpClient *http.Client) *Client {
	if strings.TrimSpace(baseURL) == "" {
		baseURL = officialBaseURL
	}
	if httpClient == nil {
		httpClient = diagnostics.NewHTTPClient(0)
	}
	return &Client{base: strings.TrimRight(provider.ResolveAPIBaseURL(provider.ProtocolOpenAIResponses, baseURL), "/"), HTTPClient: httpClient}
}

func (c *Client) request(ctx context.Context, method, path, apiKey string, body any, out any) error {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 400 {
		return provider.NewUpstreamHTTPError(resp.StatusCode)
	}
	if out != nil && resp.StatusCode != http.StatusNoContent {
		if err := json.NewDecoder(io.LimitReader(resp.Body, 32<<20)).Decode(out); err != nil {
			return err
		}
	}
	return nil
}

type Response struct {
	ID         string           `json:"id"`
	Object     string           `json:"object"`
	Status     string           `json:"status"`
	Model      string           `json:"model"`
	OutputText string           `json:"output_text"`
	Usage      Usage        `json:"usage"`
	Output     []OutputItem `json:"output"`
}

// GetOptions controls optional retrieval and replay-stream parameters.
type GetOptions struct {
	Include            []string
	Stream             bool
	StartingAfter     *int
	IncludeObfuscation *bool
}

// InputItemsOptions controls pagination for input item listing.
type InputItemsOptions struct {
	Limit   int
	Order   string
	After   string
	Include []string
}

func encodeOptions(values map[string][]string) string {
	query := url.Values{}
	for key, entries := range values {
		for _, entry := range entries {
			if entry != "" {
				query.Add(key, entry)
			}
		}
	}
	if len(query) == 0 {
		return ""
	}
	return "?" + query.Encode()
}

func getQuery(options *GetOptions) string {
	if options == nil {
		return ""
	}
	values := map[string][]string{"include": options.Include}
	if options.Stream {
		values["stream"] = []string{"true"}
	}
	if options.StartingAfter != nil {
		values["starting_after"] = []string{strconv.Itoa(*options.StartingAfter)}
	}
	if options.IncludeObfuscation != nil {
		values["include_obfuscation"] = []string{strconv.FormatBool(*options.IncludeObfuscation)}
	}
	return encodeOptions(values)
}

func inputItemsQuery(options *InputItemsOptions) string {
	if options == nil {
		return ""
	}
	values := map[string][]string{"include": options.Include}
	if options.Limit > 0 {
		values["limit"] = []string{strconv.Itoa(options.Limit)}
	}
	if options.Order != "" {
		values["order"] = []string{options.Order}
	}
	if options.After != "" {
		values["after"] = []string{options.After}
	}
	return encodeOptions(values)
}
type InputItemsResponse struct {
	Object  string            `json:"object"`
	Data    []json.RawMessage `json:"data"`
	HasMore bool              `json:"has_more"`
	FirstID string            `json:"first_id"`
	LastID  string            `json:"last_id"`
}

// InputTokensResponse is returned by POST /responses/input_tokens.
type InputTokensResponse struct {
	InputTokens int `json:"input_tokens"`
}

// DeleteResponse confirms deletion of a stored response.
type DeleteResponse struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Deleted bool   `json:"deleted"`
}

// Create creates a model response.
func (c *Client) Create(ctx context.Context, request any, apiKey string) (*Response, error) {
	var out Response
	return &out, c.request(ctx, http.MethodPost, "/responses", apiKey, request, &out)
}
// Get retrieves a stored response by ID.
func (c *Client) Get(ctx context.Context, id, apiKey string) (*Response, error) {
	return c.GetWithOptions(ctx, id, nil, apiKey)
}

// GetWithOptions retrieves a response with the documented query controls.
func (c *Client) GetWithOptions(ctx context.Context, id string, options *GetOptions, apiKey string) (*Response, error) {
	var out Response
	return &out, c.request(ctx, http.MethodGet, "/responses/"+url.PathEscape(id)+getQuery(options), apiKey, nil, &out)
}
// ListInputItems lists the input items for a stored response.
func (c *Client) ListInputItems(ctx context.Context, id, apiKey string) (*InputItemsResponse, error) {
	return c.ListInputItemsWithOptions(ctx, id, nil, apiKey)
}

// ListInputItemsWithOptions lists response input items with pagination.
func (c *Client) ListInputItemsWithOptions(ctx context.Context, id string, options *InputItemsOptions, apiKey string) (*InputItemsResponse, error) {
	var out InputItemsResponse
	return &out, c.request(ctx, http.MethodGet, "/responses/"+url.PathEscape(id)+"/input_items"+inputItemsQuery(options), apiKey, nil, &out)
}
// InputTokens counts input tokens for a Responses request.
func (c *Client) InputTokens(ctx context.Context, request any, apiKey string) (*InputTokensResponse, error) {
	var out InputTokensResponse
	return &out, c.request(ctx, http.MethodPost, "/responses/input_tokens", apiKey, request, &out)
}
// Cancel cancels an in-progress response.
func (c *Client) Cancel(ctx context.Context, id, apiKey string) (*Response, error) {
	var out Response
	return &out, c.request(ctx, http.MethodPost, "/responses/"+url.PathEscape(id)+"/cancel", apiKey, nil, &out)
}
// Compact compacts a conversation input using the Responses API.
func (c *Client) Compact(ctx context.Context, request any, apiKey string) (*Response, error) {
	var out Response
	return &out, c.request(ctx, http.MethodPost, "/responses/compact", apiKey, request, &out)
}
// Delete deletes a stored response by ID.
func (c *Client) Delete(ctx context.Context, id, apiKey string) (*DeleteResponse, error) {
	var out DeleteResponse
	return &out, c.request(ctx, http.MethodDelete, "/responses/"+url.PathEscape(id), apiKey, nil, &out)
}
