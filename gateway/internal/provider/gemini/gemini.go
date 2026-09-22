// Package gemini implements the native Google Gemini adapter on top of the
// Interactions API (`POST /v1beta/interactions`).
//
// The Gateway is stateless by design: every request re-sends the transcript,
// so the adapter always asks for `store:false` and rebuilds the input as typed
// steps (user_input, model_output, function_call, function_result). Thoughts
// stream back as reasoning; usage is reported from the interaction's running
// totals. Gemini's OpenAI-compatibility endpoint stays available for workloads
// that prefer the OpenAI wire shape.
package gemini

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	// Internal packages use EncoreHub's stable reverse-domain namespace.
	"com.0d000721.encorehub/gateway/internal/diagnostics"
	"com.0d000721.encorehub/gateway/internal/provider"
)

// officialBaseURL is the Interactions API namespace used when a profile does
// not override the endpoint.
const officialBaseURL = "https://generativelanguage.googleapis.com/v1beta"

// Adapter implements provider.Adapter for Google Gemini.
type Adapter struct {
	id     string
	base   string
	models []string
	http   *http.Client
}

// New builds an adapter from a profile.
func New(p provider.ProviderProfile) *Adapter {
	base := provider.ResolveAPIBaseURL(provider.ProtocolGemini, p.BaseURL)
	if base == "" {
		base = officialBaseURL
	}
	return &Adapter{
		id:     p.ID,
		base:   strings.TrimRight(base, "/"),
		models: append([]string(nil), p.Models...),
		http:   diagnostics.NewHTTPClient(0),
	}
}

func (a *Adapter) ID() string { return a.id }

// ===== Wire types =====

// interactionRequest is the create-interaction body. Input is either a plain
// string (single text turn) or a list of typed steps.
type interactionRequest struct {
	Model             string                       `json:"model"`
	Input             any                          `json:"input"`
	SystemInstruction string                       `json:"system_instruction,omitempty"`
	GenerationConfig  *interactionGenerationConfig `json:"generation_config,omitempty"`
	Tools             []interactionTool            `json:"tools,omitempty"`
	Store             bool                         `json:"store"`
	Stream            bool                         `json:"stream,omitempty"`
}

// interactionGenerationConfig mirrors the documented sampling and thinking
// controls. Pointers keep unset fields out of the request.
type interactionGenerationConfig struct {
	Temperature     *float32 `json:"temperature,omitempty"`
	TopP            *float32 `json:"top_p,omitempty"`
	TopK            *int     `json:"top_k,omitempty"`
	MaxOutputTokens *int     `json:"max_output_tokens,omitempty"`
	ThinkingLevel   string   `json:"thinking_level,omitempty"`
}

// interactionTool is one tool declaration. Client functions use type
// "function" with a name, description, and JSON-schema parameters.
type interactionTool struct {
	Type        string         `json:"type"`
	Name        string         `json:"name,omitempty"`
	Description string         `json:"description,omitempty"`
	Parameters  map[string]any `json:"parameters,omitempty"`
}

// interactionStep is one entry of the interaction timeline.
type interactionStep struct {
	Type      string               `json:"type"`
	Content   []interactionContent `json:"content,omitempty"`
	ID        string               `json:"id,omitempty"`
	Name      string               `json:"name,omitempty"`
	Arguments json.RawMessage      `json:"arguments,omitempty"`
	CallID    string               `json:"call_id,omitempty"`
	Result    []interactionContent `json:"result,omitempty"`
	// Thought steps carry either text content or a thought field.
	Thought string `json:"thought,omitempty"`
}

// interactionContent is one content block (text or inline media).
type interactionContent struct {
	Type     string `json:"type"`
	Text     string `json:"text,omitempty"`
	Data     string `json:"data,omitempty"`
	MIMEType string `json:"mime_type,omitempty"`
}

// interaction is the response resource. Older revisions used `outputs` where
// current ones use `steps`, so both are decoded.
type interaction struct {
	ID      string            `json:"id"`
	Status  string            `json:"status"`
	Usage   interactionUsage  `json:"usage"`
	Steps   []interactionStep `json:"steps"`
	Outputs []interactionStep `json:"outputs"`
	Error   *interactionError `json:"error"`
}

type interactionError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Status  string `json:"status"`
}

// interactionUsage accepts both the token-count spellings seen across API
// revisions; only one family is populated per response.
type interactionUsage struct {
	InputTokens             *int `json:"input_tokens"`
	OutputTokens            *int `json:"output_tokens"`
	PromptTokens            *int `json:"prompt_tokens"`
	CompletionTokens        *int `json:"completion_tokens"`
	TotalTokens             *int `json:"total_tokens"`
	CachedInputTokens       *int `json:"cached_input_tokens"`
	CachedContentTokenCount *int `json:"cached_content_token_count"`
}

// ===== Request mapping =====

// buildInteractionRequest converts one unified chat request into the
// stateless Interactions API shape.
func buildInteractionRequest(req *provider.ChatRequest) (interactionRequest, error) {
	steps, systemInstruction, err := stepsFromMessages(req.Messages)
	if err != nil {
		return interactionRequest{}, err
	}
	body := interactionRequest{
		Model:             req.Model,
		Input:             steps,
		SystemInstruction: strings.TrimSpace(strings.TrimSpace(req.SystemPrompt) + "\n" + systemInstruction),
		GenerationConfig:  generationConfig(req),
		Store:             false,
		Stream:            req.Stream,
	}
	for _, tool := range req.Tools {
		if tool.Function == nil {
			continue
		}
		body.Tools = append(body.Tools, interactionTool{
			Type:        "function",
			Name:        tool.Function.Name,
			Description: tool.Function.Description,
			Parameters:  tool.Function.Parameters,
		})
	}
	return body, nil
}

// stepsFromMessages rebuilds the conversation timeline. System messages are
// folded into the request's system instruction instead of a step.
func stepsFromMessages(messages []provider.Message) ([]interactionStep, string, error) {
	steps := make([]interactionStep, 0, len(messages))
	systems := make([]string, 0, 1)
	// Tool results name the function they answer; the name only exists on the
	// assistant's call, so it is resolved from the preceding messages.
	callNames := make(map[string]string)
	for _, message := range messages {
		for _, call := range message.ToolCalls {
			callNames[call.ID] = call.Name
		}
	}
	for _, message := range messages {
		switch message.Role {
		case "system":
			if text := strings.TrimSpace(message.Content); text != "" {
				systems = append(systems, text)
			}
		case "assistant":
			if strings.TrimSpace(message.Content) != "" {
				steps = append(steps, interactionStep{
					Type:    "model_output",
					Content: []interactionContent{{Type: "text", Text: message.Content}},
				})
			}
			for _, call := range message.ToolCalls {
				arguments := json.RawMessage(strings.TrimSpace(call.Arguments))
				if len(arguments) == 0 || !json.Valid(arguments) {
					arguments = json.RawMessage("{}")
				}
				steps = append(steps, interactionStep{
					Type:      "function_call",
					ID:        call.ID,
					Name:      call.Name,
					Arguments: arguments,
				})
			}
		case "tool":
			steps = append(steps, interactionStep{
				Type:   "function_result",
				Name:   callNames[message.ToolCallID],
				CallID: message.ToolCallID,
				Result: []interactionContent{{Type: "text", Text: message.Content}},
			})
		default:
			steps = append(steps, interactionStep{
				Type:    "user_input",
				Content: contentFromMessage(message),
			})
		}
	}
	return steps, strings.Join(systems, "\n\n"), nil
}

// contentFromMessage keeps text and inline media blocks in order.
func contentFromMessage(message provider.Message) []interactionContent {
	if len(message.Parts) == 0 {
		return []interactionContent{{Type: "text", Text: message.Content}}
	}
	content := make([]interactionContent, 0, len(message.Parts)+1)
	for _, part := range message.Parts {
		switch part.Type {
		case "image":
			mimeType, data := decodeMediaPart(part)
			content = append(content, interactionContent{
				Type:     "image",
				Data:     data,
				MIMEType: mimeType,
			})
		case "text":
			if strings.TrimSpace(part.Text) != "" {
				content = append(content, interactionContent{Type: "text", Text: part.Text})
			}
		}
	}
	if len(content) == 0 {
		content = append(content, interactionContent{Type: "text", Text: message.Content})
	}
	return content
}

// decodeMediaPart splits an optional data URL into a mime type and base64
// payload.
func decodeMediaPart(part provider.ContentPart) (string, string) {
	mimeType, data := part.MediaType, part.Data
	if strings.HasPrefix(data, "data:") {
		header, payload, found := strings.Cut(strings.TrimPrefix(data, "data:"), ";base64,")
		if found {
			if mimeType == "" {
				mimeType = header
			}
			return mimeType, payload
		}
	}
	return mimeType, data
}

// generationConfig maps the unified sampling controls onto Gemini's config.
func generationConfig(req *provider.ChatRequest) *interactionGenerationConfig {
	config := &interactionGenerationConfig{}
	// A zero temperature is the unified "unset" value, not a request for 0.
	if req.Temperature > 0 {
		temperature := req.Temperature
		config.Temperature = &temperature
	}
	if req.TopP > 0 {
		topP := req.TopP
		config.TopP = &topP
	}
	if req.TopK > 0 {
		topK := req.TopK
		config.TopK = &topK
	}
	maxOutput := req.MaxCompletionTokens
	if maxOutput == 0 {
		maxOutput = req.MaxTokens
	}
	if maxOutput > 0 {
		config.MaxOutputTokens = &maxOutput
	}
	if level := thinkingLevel(req); level != "" {
		config.ThinkingLevel = level
	}
	if config.Temperature == nil && config.TopP == nil && config.TopK == nil &&
		config.MaxOutputTokens == nil && config.ThinkingLevel == "" {
		return nil
	}
	return config
}

// thinkingLevel maps the unified reasoning controls. Gemini offers named
// levels rather than a token budget; heavier modes map to "high".
func thinkingLevel(req *provider.ChatRequest) string {
	if req.DisableReasoning {
		return "low"
	}
	switch strings.ToLower(strings.TrimSpace(req.ReasoningEffort)) {
	case "low":
		return "low"
	case "medium":
		return "medium"
	case "high":
		return "high"
	default:
		return ""
	}
}

// ===== Responses =====

// Chat runs one non-streaming interaction.
func (a *Adapter) Chat(ctx context.Context, req *provider.ChatRequest, apiKey string) (*provider.ChatResponse, error) {
	body, err := buildInteractionRequest(req)
	if err != nil {
		return nil, err
	}
	body.Stream = false
	response, err := a.post(ctx, apiKey, body)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	var result interaction
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("gemini decode: %w", err)
	}
	if result.Error != nil {
		return nil, fmt.Errorf("gemini: %s", result.Error.Message)
	}
	content, reasoning, finishReason := decodeInteraction(result)
	usage := decodeUsage(result.Usage)
	return &provider.ChatResponse{
		Content:                  content,
		ReasoningContent:         reasoning,
		FinishReason:             finishReason,
		InputTokens:              usage.InputTokens,
		OutputTokens:             usage.OutputTokens,
		CacheCreationInputTokens: usage.CacheCreationInputTokens,
		CacheReadInputTokens:     usage.CacheReadInputTokens,
		Model:                    req.Model,
	}, nil
}

// decodeInteraction flattens the model timeline into text, reasoning, and a
// finish reason.
func decodeInteraction(result interaction) (string, string, string) {
	steps := result.Steps
	if len(steps) == 0 {
		steps = result.Outputs
	}
	var content strings.Builder
	var reasoning strings.Builder
	for _, step := range steps {
		switch step.Type {
		case "model_output":
			for _, block := range step.Content {
				if block.Type == "text" && block.Text != "" {
					content.WriteString(block.Text)
				}
			}
		case "thought":
			if step.Thought != "" {
				reasoning.WriteString(step.Thought)
			}
			for _, block := range step.Content {
				if block.Type == "text" && block.Text != "" {
					reasoning.WriteString(block.Text)
				}
			}
		}
	}
	return content.String(), reasoning.String(), finishReason(result.Status)
}

// finishReason maps the interaction status onto the unified reason strings.
func finishReason(status string) string {
	switch status {
	case "requires_action":
		return "tool_calls"
	case "failed":
		return "error"
	default:
		return "stop"
	}
}

// decodeUsage normalizes the documented usage shapes.
func decodeUsage(usage interactionUsage) provider.UsageEvent {
	event := provider.UsageEvent{}
	switch {
	case usage.InputTokens != nil:
		event.InputTokens = *usage.InputTokens
	case usage.PromptTokens != nil:
		event.InputTokens = *usage.PromptTokens
	}
	switch {
	case usage.OutputTokens != nil:
		event.OutputTokens = *usage.OutputTokens
	case usage.CompletionTokens != nil:
		event.OutputTokens = *usage.CompletionTokens
	case usage.TotalTokens != nil && usage.InputTokens != nil:
		event.OutputTokens = *usage.TotalTokens - *usage.InputTokens
	}
	if usage.CachedInputTokens != nil {
		event.CacheReadInputTokens = *usage.CachedInputTokens
	} else if usage.CachedContentTokenCount != nil {
		event.CacheReadInputTokens = *usage.CachedContentTokenCount
	}
	return event
}

// ===== Streaming =====

// ChatStream runs a streaming interaction and maps its SSE events.
func (a *Adapter) ChatStream(ctx context.Context, req *provider.ChatRequest, apiKey string) (<-chan provider.StreamEvent, error) {
	body, err := buildInteractionRequest(req)
	if err != nil {
		return nil, err
	}
	body.Stream = true
	response, err := a.postWithQuery(ctx, apiKey, body, "alt=sse")
	if err != nil {
		return nil, err
	}
	events := make(chan provider.StreamEvent, 16)
	go func() {
		defer close(events)
		defer response.Body.Close()
		scanner := bufio.NewScanner(response.Body)
		scanner.Buffer(make([]byte, 0, 64*1024), 1<<20)
		for scanner.Scan() {
			for _, event := range decodeStreamLine(scanner.Text()) {
				events <- event
			}
		}
		if err := scanner.Err(); err != nil && !errors.Is(err, context.Canceled) {
			events <- provider.StreamEvent{Error: err}
		}
	}()
	return events, nil
}

// streamEnvelope is one SSE payload of a streaming interaction.
type streamEnvelope struct {
	EventType string `json:"event_type"`
	Index     int    `json:"index"`
	Step      *struct {
		Type string `json:"type"`
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"step"`
	Delta *struct {
		Type      string `json:"type"`
		Text      string `json:"text"`
		Thought   string `json:"thought"`
		Arguments string `json:"arguments"`
	} `json:"delta"`
	Interaction *interaction `json:"interaction"`
	Error       *struct {
		Message string `json:"message"`
	} `json:"error"`
}

// decodeStreamLine parses one SSE line from the Interactions stream and
// returns the adapter events it implies. Pure function, exposed for tests.
func decodeStreamLine(line string) []provider.StreamEvent {
	if !strings.HasPrefix(line, "data: ") {
		return nil
	}
	data := strings.TrimPrefix(line, "data: ")
	if data == "[DONE]" {
		return nil
	}
	var envelope streamEnvelope
	if err := json.Unmarshal([]byte(data), &envelope); err != nil {
		return nil
	}

	switch envelope.EventType {
	case "step.start", "content.start":
		if envelope.Step == nil || envelope.Step.Type != "function_call" {
			return nil
		}
		return []provider.StreamEvent{{ToolCall: &provider.ToolCallEvent{
			Index: envelope.Index,
			ID:    envelope.Step.ID,
			Name:  envelope.Step.Name,
		}}}
	case "step.delta", "content.delta":
		if envelope.Delta == nil {
			return nil
		}
		switch envelope.Delta.Type {
		case "text":
			if envelope.Delta.Text == "" {
				return nil
			}
			return []provider.StreamEvent{{Delta: &provider.DeltaEvent{Content: envelope.Delta.Text}}}
		case "thought":
			thought := envelope.Delta.Thought
			if thought == "" {
				thought = envelope.Delta.Text
			}
			if thought == "" {
				return nil
			}
			return []provider.StreamEvent{{Reasoning: &provider.ReasoningEvent{Content: thought}}}
		case "arguments_delta":
			if envelope.Delta.Arguments == "" {
				return nil
			}
			return []provider.StreamEvent{{ToolCall: &provider.ToolCallEvent{
				Index:     envelope.Index,
				Arguments: envelope.Delta.Arguments,
			}}}
		}
		return nil
	case "interaction.completed", "interaction.complete":
		if envelope.Interaction == nil {
			return nil
		}
		events := make([]provider.StreamEvent, 0, 2)
		deltas := provider.DeltaEvent{FinishReason: finishReason(envelope.Interaction.Status)}
		events = append(events, provider.StreamEvent{Delta: &deltas})
		usage := decodeUsage(envelope.Interaction.Usage)
		if usage != (provider.UsageEvent{}) {
			events = append(events, provider.StreamEvent{Usage: &usage})
		}
		return events
	case "error":
		if envelope.Error == nil {
			return nil
		}
		return []provider.StreamEvent{{Error: fmt.Errorf("gemini: %s", envelope.Error.Message)}}
	default:
		return nil
	}
}

// ===== HTTP =====

// post sends one interaction request.
func (a *Adapter) post(ctx context.Context, apiKey string, body interactionRequest) (*http.Response, error) {
	return a.postWithQuery(ctx, apiKey, body, "")
}

// postWithQuery sends one interaction request with an optional query string.
func (a *Adapter) postWithQuery(ctx context.Context, apiKey string, body interactionRequest, query string) (*http.Response, error) {
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("gemini encode: %w", err)
	}
	url := a.base + "/interactions"
	if query != "" {
		url += "?" + query
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	// Gemini authenticates with its own header; the key is never logged.
	request.Header.Set("x-goog-api-key", strings.TrimSpace(apiKey))
	response, err := a.http.Do(request)
	if err != nil {
		return nil, err
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		defer response.Body.Close()
		detail, _ := io.ReadAll(io.LimitReader(response.Body, 8<<10))
		return nil, fmt.Errorf("gemini status %d: %s", response.StatusCode, strings.TrimSpace(string(detail)))
	}
	return response, nil
}

// ===== Models =====

type modelsResponse struct {
	Models []struct {
		Name        string `json:"name"`
		DisplayName string `json:"displayName"`
	} `json:"models"`
}

// ListModels returns the models the key can reach.
func (a *Adapter) ListModels(ctx context.Context, apiKey string) ([]provider.ModelInfo, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, a.base+"/models?pageSize=1000", nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("x-goog-api-key", strings.TrimSpace(apiKey))
	response, err := a.http.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		detail, _ := io.ReadAll(io.LimitReader(response.Body, 8<<10))
		return nil, fmt.Errorf("gemini status %d: %s", response.StatusCode, strings.TrimSpace(string(detail)))
	}
	var payload modelsResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("gemini decode: %w", err)
	}
	models := make([]provider.ModelInfo, 0, len(payload.Models))
	for _, model := range payload.Models {
		id := strings.TrimPrefix(model.Name, "models/")
		if id == "" {
			continue
		}
		models = append(models, provider.ModelInfo{
			ID:      id,
			Name:    model.DisplayName,
			OwnedBy: "google",
		})
	}
	return models, nil
}

// ValidateKey reports whether the key can list models.
func (a *Adapter) ValidateKey(ctx context.Context, apiKey string) error {
	_, err := a.ListModels(ctx, apiKey)
	return err
}
