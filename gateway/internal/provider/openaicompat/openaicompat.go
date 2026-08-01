// Package openaicompat implements a templated adapter for any provider that
// speaks the OpenAI Chat Completions API. OpenAI, DeepSeek, and most local /
// third-party gateways all fit this shape — they differ only by base URL and
// model list, which come from a ProviderProfile.
//
// Anthropic is intentionally NOT covered here; it has a different auth header
// and request/response shape and keeps its own adapter.
package openaicompat

import (
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
	goopenai "github.com/sashabaranov/go-openai"
)

// Adapter implements provider.Adapter for any OpenAI-compatible endpoint.
type Adapter struct {
	id              string
	baseURL         string
	models          []string
	embeddingModels map[string]struct{}
}

// New builds an adapter from a profile. An empty BaseURL falls back to the
// go-openai SDK default (the official OpenAI endpoint).
func New(p provider.ProviderProfile) *Adapter {
	embeddingModels := make(map[string]struct{})
	for _, model := range p.Models {
		if p.ModelType(model) == provider.ModelTypeEmbedding {
			embeddingModels[model] = struct{}{}
		}
	}
	return &Adapter{
		id:              p.ID,
		baseURL:         provider.ResolveAPIBaseURL(provider.ProtocolOpenAI, p.BaseURL),
		models:          p.Models,
		embeddingModels: embeddingModels,
	}
}

func (a *Adapter) ID() string { return a.id }

// config builds the go-openai client config for this profile's endpoint.
// Split out from client() so tests can assert the resolved base URL (the
// Client itself doesn't expose it).
func (a *Adapter) config(apiKey string) goopenai.ClientConfig {
	cfg := goopenai.DefaultConfig(apiKey)
	cfg.HTTPClient = diagnostics.NewHTTPClient(0)
	if a.baseURL != "" {
		cfg.BaseURL = a.baseURL
	}
	return cfg
}

// client builds a go-openai client pointed at this profile's endpoint.
func (a *Adapter) client(apiKey string) *goopenai.Client {
	return goopenai.NewClientWithConfig(a.config(apiKey))
}

// buildRequest translates the unified ChatRequest into the provider-specific
// go-openai request, mapping every field the SDK supports.
func (a *Adapter) buildRequest(req *provider.ChatRequest) goopenai.ChatCompletionRequest {
	cr := goopenai.ChatCompletionRequest{
		Model:               req.Model,
		Messages:            toMessages(req),
		MaxTokens:           req.MaxTokens,
		MaxCompletionTokens: req.MaxCompletionTokens,
		Temperature:         req.Temperature,
		TopP:                req.TopP,
		FrequencyPenalty:    req.FrequencyPenalty,
		PresencePenalty:     req.PresencePenalty,
		Stop:                req.Stop,
		Seed:                req.Seed,
	}
	if req.JSONMode {
		cr.ResponseFormat = &goopenai.ChatCompletionResponseFormat{
			Type: goopenai.ChatCompletionResponseFormatTypeJSONObject,
		}
	}
	if req.ReasoningEffort != "" {
		cr.ReasoningEffort = req.ReasoningEffort
	}
	if len(req.Tools) > 0 {
		cr.Tools = toOpenAITools(req.Tools)
	}
	return cr
}

// toOpenAITools converts EncoreHub Tool definitions to go-openai format.
func toOpenAITools(tools []provider.Tool) []goopenai.Tool {
	out := make([]goopenai.Tool, 0, len(tools))
	for _, t := range tools {
		out = append(out, goopenai.Tool{
			Type: goopenai.ToolTypeFunction,
			Function: &goopenai.FunctionDefinition{
				Name:        t.Function.Name,
				Description: t.Function.Description,
				// go-openai defines Parameters as `any` — pass the map directly
				// so encoding/json serialises it as a JSON object. Passing a
				// []byte (json.RawMessage) would be base64-encoded by the
				// stdlib and rejected by providers as an invalid schema.
				Parameters: t.Function.Parameters,
			},
		})
	}
	return out
}

func (a *Adapter) Chat(ctx context.Context, req *provider.ChatRequest, apiKey string) (*provider.ChatResponse, error) {
	// Embedding models are utility-only even if a caller bypasses the frontend.
	if _, embeddingOnly := a.embeddingModels[req.Model]; embeddingOnly {
		return nil, fmt.Errorf("%s model %q does not support chat", a.id, req.Model)
	}
	cr := a.buildRequest(req)
	resp, err := a.createChatCompletion(ctx, cr, req, apiKey)
	if err != nil {
		return nil, fmt.Errorf("%s chat: %w", a.id, err)
	}
	if len(resp.Choices) == 0 {
		return nil, fmt.Errorf("%s returned no choices", a.id)
	}
	return &provider.ChatResponse{
		Content:          resp.Choices[0].Message.Content,
		ReasoningContent: resp.Choices[0].Message.ReasoningContent,
		FinishReason:     string(resp.Choices[0].FinishReason),
		InputTokens:      resp.Usage.PromptTokens,
		OutputTokens:     resp.Usage.CompletionTokens,
		Model:            resp.Model,
	}, nil
}

// Embed calls the provider's OpenAI-compatible embeddings endpoint without
// involving chat messages, streaming, tools, or conversation persistence.
func (a *Adapter) Embed(ctx context.Context, req *provider.EmbeddingRequest, apiKey string) (*provider.EmbeddingResponse, error) {
	if req == nil {
		return nil, fmt.Errorf("%s embedding request is required", a.id)
	}
	if _, embeddingOnly := a.embeddingModels[req.Model]; !embeddingOnly {
		return nil, fmt.Errorf("%s model %q is not configured for embeddings", a.id, req.Model)
	}
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("%s embedding request: %w", a.id, err)
	}
	endpoint := strings.TrimRight(a.config(apiKey).BaseURL, "/") + "/embeddings"
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("%s embedding request: %w", a.id, err)
	}
	httpReq.Header.Set("Accept", "application/json")
	httpReq.Header.Set("Content-Type", "application/json")
	if apiKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	}

	httpResp, err := a.config(apiKey).HTTPClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("%s embeddings: %w", a.id, err)
	}
	defer httpResp.Body.Close()
	if httpResp.StatusCode < http.StatusOK || httpResp.StatusCode >= http.StatusBadRequest {
		// Do not surface provider response bodies because they may contain input.
		return nil, fmt.Errorf("%s embeddings returned HTTP %d", a.id, httpResp.StatusCode)
	}

	var response provider.EmbeddingResponse
	if err := json.NewDecoder(io.LimitReader(httpResp.Body, 32<<20)).Decode(&response); err != nil {
		return nil, fmt.Errorf("%s embeddings response: %w", a.id, err)
	}
	if len(response.Data) != len(req.Input) {
		return nil, fmt.Errorf("%s embeddings returned %d vectors for %d inputs", a.id, len(response.Data), len(req.Input))
	}
	return &response, nil
}

func (a *Adapter) createChatCompletion(
	ctx context.Context,
	cr goopenai.ChatCompletionRequest,
	req *provider.ChatRequest,
	apiKey string,
) (goopenai.ChatCompletionResponse, error) {
	extra := a.extraBodyForRequest(req)
	if len(extra) == 0 {
		return a.client(apiKey).CreateChatCompletion(ctx, cr)
	}
	return a.createChatCompletionWithExtraBody(ctx, cr, apiKey, extra)
}

func (a *Adapter) extraBodyForRequest(req *provider.ChatRequest) map[string]any {
	if req == nil || !req.DisableReasoning || !a.usesDeepSeekThinkingSwitch(req.Model) {
		return nil
	}
	return map[string]any{
		"thinking": map[string]string{"type": "disabled"},
	}
}

func (a *Adapter) usesDeepSeekThinkingSwitch(model string) bool {
	id := strings.ToLower(a.id)
	baseURL := strings.ToLower(a.baseURL)
	model = strings.ToLower(model)
	return strings.Contains(id, "deepseek") ||
		strings.Contains(baseURL, "api.deepseek.com") ||
		strings.Contains(model, "deepseek-v4-")
}

func (a *Adapter) createChatCompletionWithExtraBody(
	ctx context.Context,
	cr goopenai.ChatCompletionRequest,
	apiKey string,
	extra map[string]any,
) (goopenai.ChatCompletionResponse, error) {
	var resp goopenai.ChatCompletionResponse
	baseBody, err := json.Marshal(cr)
	if err != nil {
		return resp, fmt.Errorf("marshal request: %w", err)
	}
	var body map[string]any
	if err := json.Unmarshal(baseBody, &body); err != nil {
		return resp, fmt.Errorf("unmarshal request body: %w", err)
	}
	for k, v := range extra {
		body[k] = v
	}
	jsonBody, err := json.Marshal(body)
	if err != nil {
		return resp, fmt.Errorf("marshal request body: %w", err)
	}

	endpoint := strings.TrimRight(a.config(apiKey).BaseURL, "/") + "/chat/completions"
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(jsonBody))
	if err != nil {
		return resp, fmt.Errorf("build request: %w", err)
	}
	httpReq.Header.Set("Accept", "application/json")
	httpReq.Header.Set("Content-Type", "application/json")
	if apiKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	}

	httpResp, err := a.config(apiKey).HTTPClient.Do(httpReq)
	if err != nil {
		return resp, err
	}
	defer httpResp.Body.Close()

	if httpResp.StatusCode < http.StatusOK || httpResp.StatusCode >= http.StatusBadRequest {
		bodyBytes, _ := io.ReadAll(httpResp.Body)
		return resp, fmt.Errorf("http %d: %s", httpResp.StatusCode, string(bodyBytes))
	}
	if err := json.NewDecoder(httpResp.Body).Decode(&resp); err != nil {
		return resp, fmt.Errorf("decode response: %w", err)
	}
	return resp, nil
}

func (a *Adapter) ChatStream(ctx context.Context, req *provider.ChatRequest, apiKey string) (<-chan provider.StreamEvent, error) {
	cr := a.buildRequest(req)
	cr.Stream = true
	stream, err := a.client(apiKey).CreateChatCompletionStream(ctx, cr)
	if err != nil {
		return nil, fmt.Errorf("%s stream: %w", a.id, err)
	}

	events := make(chan provider.StreamEvent, 64)
	id := a.id
	go func() {
		defer close(events)
		defer stream.Close()
		for {
			chunk, err := stream.Recv()
			if err == io.EOF {
				return
			}
			if err != nil {
				events <- provider.StreamEvent{Error: fmt.Errorf("%s stream recv: %w", id, err)}
				return
			}
			if len(chunk.Choices) > 0 {
				delta := chunk.Choices[0].Delta
				// Reasoning chain (deepseek-reasoner and compatible endpoints).
				if delta.ReasoningContent != "" {
					events <- provider.StreamEvent{
						Reasoning: &provider.ReasoningEvent{Content: delta.ReasoningContent},
					}
				}
				// Tool calls arrive as fragments; forward each with its index so
				// the gateway can aggregate arguments across chunks.
				for _, tc := range delta.ToolCalls {
					idx := 0
					if tc.Index != nil {
						idx = *tc.Index
					}
					events <- provider.StreamEvent{
						ToolCall: &provider.ToolCallEvent{
							Index:     idx,
							ID:        tc.ID,
							Name:      tc.Function.Name,
							Arguments: tc.Function.Arguments,
						},
					}
				}
				if delta.Content != "" || chunk.Choices[0].FinishReason != "" {
					events <- provider.StreamEvent{
						Delta: &provider.DeltaEvent{
							Content:      delta.Content,
							FinishReason: string(chunk.Choices[0].FinishReason),
						},
					}
				}
			}
			if chunk.Usage != nil {
				events <- provider.StreamEvent{
					Usage: &provider.UsageEvent{
						InputTokens:  chunk.Usage.PromptTokens,
						OutputTokens: chunk.Usage.CompletionTokens,
					},
				}
			}
		}
	}()
	return events, nil
}

// ListModels returns the profile's configured models. We deliberately do not
// hit the provider's /models endpoint here: custom/local endpoints may not
// implement it, and the profile is the source of truth the user maintains.
func (a *Adapter) ListModels(_ context.Context, _ string) ([]provider.ModelInfo, error) {
	out := make([]provider.ModelInfo, 0, len(a.models))
	for _, m := range a.models {
		out = append(out, provider.ModelInfo{ID: m, Name: m, Provider: a.id})
	}
	return out, nil
}

func (a *Adapter) ValidateKey(ctx context.Context, apiKey string) error {
	_, err := a.client(apiKey).ListModels(ctx)
	return err
}

// toMessages converts EncoreHub unified messages to OpenAI format, prepending
// the system prompt as the first message.
func toMessages(req *provider.ChatRequest) []goopenai.ChatCompletionMessage {
	messages := make([]goopenai.ChatCompletionMessage, 0, len(req.Messages)+1)
	if req.SystemPrompt != "" {
		messages = append(messages, goopenai.ChatCompletionMessage{
			Role:    goopenai.ChatMessageRoleSystem,
			Content: req.SystemPrompt,
		})
	}
	for _, msg := range req.Messages {
		gmsg := goopenai.ChatCompletionMessage{
			Role:       msg.Role,
			Content:    msg.Content,
			ToolCallID: msg.ToolCallID,
		}
		if len(msg.ToolCalls) > 0 {
			gmsg.ToolCalls = toOpenAIToolCalls(msg.ToolCalls)
		}
		messages = append(messages, gmsg)
	}
	return messages
}

// toOpenAIToolCalls converts EncoreHub ToolCallMessages to go-openai format.
func toOpenAIToolCalls(tcms []provider.ToolCallMessage) []goopenai.ToolCall {
	out := make([]goopenai.ToolCall, 0, len(tcms))
	for _, tc := range tcms {
		out = append(out, goopenai.ToolCall{
			ID:   tc.ID,
			Type: goopenai.ToolTypeFunction,
			Function: goopenai.FunctionCall{
				Name:      tc.Name,
				Arguments: tc.Arguments,
			},
		})
	}
	return out
}
