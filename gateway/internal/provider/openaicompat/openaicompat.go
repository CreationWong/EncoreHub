// Package openaicompat implements a templated adapter for any provider that
// speaks the OpenAI Chat Completions API. OpenAI, DeepSeek, and most local /
// third-party gateways all fit this shape — they differ only by base URL and
// model list, which come from a ProviderProfile.
//
// Anthropic is intentionally NOT covered here; it has a different auth header
// and request/response shape and keeps its own adapter.
package openaicompat

import (
	"context"
	"fmt"
	"io"

	"github.com/encorehub/gateway/internal/provider"
	goopenai "github.com/sashabaranov/go-openai"
)

// Adapter implements provider.Adapter for any OpenAI-compatible endpoint.
type Adapter struct {
	id      string
	baseURL string
	models  []string
}

// New builds an adapter from a profile. An empty BaseURL falls back to the
// go-openai SDK default (the official OpenAI endpoint).
func New(p provider.ProviderProfile) *Adapter {
	return &Adapter{
		id:      p.ID,
		baseURL: p.BaseURL,
		models:  p.Models,
	}
}

func (a *Adapter) ID() string { return a.id }

// config builds the go-openai client config for this profile's endpoint.
// Split out from client() so tests can assert the resolved base URL (the
// Client itself doesn't expose it).
func (a *Adapter) config(apiKey string) goopenai.ClientConfig {
	cfg := goopenai.DefaultConfig(apiKey)
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
	return cr
}

func (a *Adapter) Chat(ctx context.Context, req *provider.ChatRequest, apiKey string) (*provider.ChatResponse, error) {
	resp, err := a.client(apiKey).CreateChatCompletion(ctx, a.buildRequest(req))
	if err != nil {
		return nil, fmt.Errorf("%s chat: %w", a.id, err)
	}
	if len(resp.Choices) == 0 {
		return nil, fmt.Errorf("%s returned no choices", a.id)
	}
	return &provider.ChatResponse{
		Content:      resp.Choices[0].Message.Content,
		FinishReason: string(resp.Choices[0].FinishReason),
		InputTokens:  resp.Usage.PromptTokens,
		OutputTokens: resp.Usage.CompletionTokens,
		Model:        resp.Model,
	}, nil
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
		messages = append(messages, goopenai.ChatCompletionMessage{
			Role:    msg.Role,
			Content: msg.Content,
		})
	}
	return messages
}
