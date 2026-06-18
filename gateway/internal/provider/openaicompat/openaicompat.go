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

func (a *Adapter) Chat(ctx context.Context, req *provider.ChatRequest, apiKey string) (*provider.ChatResponse, error) {
	resp, err := a.client(apiKey).CreateChatCompletion(ctx, goopenai.ChatCompletionRequest{
		Model:       req.Model,
		Messages:    toMessages(req),
		MaxTokens:   req.MaxTokens,
		Temperature: req.Temperature,
	})
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
	stream, err := a.client(apiKey).CreateChatCompletionStream(ctx, goopenai.ChatCompletionRequest{
		Model:       req.Model,
		Messages:    toMessages(req),
		MaxTokens:   req.MaxTokens,
		Temperature: req.Temperature,
		Stream:      true,
	})
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
				events <- provider.StreamEvent{
					Delta: &provider.DeltaEvent{
						Content:      delta.Content,
						FinishReason: string(chunk.Choices[0].FinishReason),
					},
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
