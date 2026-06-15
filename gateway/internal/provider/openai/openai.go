// Package openai implements the OpenAI provider adapter.
//
// Uses the go-openai SDK for API calls, translating between
// EncoreHub's unified format and OpenAI's Chat Completions API.
package openai

import (
	"context"
	"fmt"
	"io"

	"github.com/encorehub/gateway/internal/provider"
	goopenai "github.com/sashabaranov/go-openai"
)

// Adapter implements provider.Adapter for OpenAI.
type Adapter struct{}

func New() *Adapter {
	return &Adapter{}
}

func (a *Adapter) ID() string {
	return "openai"
}

func (a *Adapter) Chat(ctx context.Context, req *provider.ChatRequest, apiKey string) (*provider.ChatResponse, error) {
	client := goopenai.NewClient(apiKey)

	messages := toOpenAIMessages(req)

	resp, err := client.CreateChatCompletion(ctx, goopenai.ChatCompletionRequest{
		Model:       req.Model,
		Messages:    messages,
		MaxTokens:   req.MaxTokens,
		Temperature: req.Temperature,
	})
	if err != nil {
		return nil, fmt.Errorf("openai chat: %w", err)
	}

	if len(resp.Choices) == 0 {
		return nil, fmt.Errorf("openai returned no choices")
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
	client := goopenai.NewClient(apiKey)

	messages := toOpenAIMessages(req)

	stream, err := client.CreateChatCompletionStream(ctx, goopenai.ChatCompletionRequest{
		Model:       req.Model,
		Messages:    messages,
		MaxTokens:   req.MaxTokens,
		Temperature: req.Temperature,
		Stream:      true,
	})
	if err != nil {
		return nil, fmt.Errorf("openai stream: %w", err)
	}

	events := make(chan provider.StreamEvent, 64)

	go func() {
		defer close(events)
		defer stream.Close()

		for {
			chunk, err := stream.Recv()
			if err == io.EOF {
				return
			}
			if err != nil {
				events <- provider.StreamEvent{Error: fmt.Errorf("openai stream recv: %w", err)}
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

			// Send usage on the last chunk
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

func (a *Adapter) ListModels(ctx context.Context, apiKey string) ([]provider.ModelInfo, error) {
	client := goopenai.NewClient(apiKey)

	models, err := client.ListModels(ctx)
	if err != nil {
		return nil, fmt.Errorf("openai list models: %w", err)
	}

	result := make([]provider.ModelInfo, 0, len(models.Models))
	for _, m := range models.Models {
		result = append(result, provider.ModelInfo{
			ID:       m.ID,
			Name:     m.ID,
			Provider: "openai",
			ContextLimit: 128000, // default; actual limit varies by model
		})
	}
	return result, nil
}

func (a *Adapter) ValidateKey(ctx context.Context, apiKey string) error {
	client := goopenai.NewClient(apiKey)
	_, err := client.ListModels(ctx)
	return err
}

// toOpenAIMessages converts EncoreHub unified messages to OpenAI format.
func toOpenAIMessages(req *provider.ChatRequest) []goopenai.ChatCompletionMessage {
	messages := make([]goopenai.ChatCompletionMessage, 0, len(req.Messages)+1)

	// System prompt as first message
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
