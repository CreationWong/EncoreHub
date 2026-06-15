package deepseek

import (
	"context"
	"fmt"
	"io"

	"github.com/encorehub/gateway/internal/provider"
	goopenai "github.com/sashabaranov/go-openai"
)

const deepseekBaseURL = "https://api.deepseek.com/v1"

// Adapter implements provider.Adapter for DeepSeek.
// DeepSeek uses the OpenAI-compatible API format.
type Adapter struct{}

func New() *Adapter { return &Adapter{} }

func (a *Adapter) ID() string { return "deepseek" }

func (a *Adapter) Chat(ctx context.Context, req *provider.ChatRequest, apiKey string) (*provider.ChatResponse, error) {
	cfg := goopenai.DefaultConfig(apiKey)
	cfg.BaseURL = deepseekBaseURL
	client := goopenai.NewClientWithConfig(cfg)

	messages := toDeepSeekMessages(req)
	resp, err := client.CreateChatCompletion(ctx, goopenai.ChatCompletionRequest{
		Model:       req.Model,
		Messages:    messages,
		MaxTokens:   req.MaxTokens,
		Temperature: float32(req.Temperature),
	})
	if err != nil {
		return nil, fmt.Errorf("deepseek chat: %w", err)
	}
	if len(resp.Choices) == 0 {
		return nil, fmt.Errorf("deepseek returned no choices")
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
	cfg := goopenai.DefaultConfig(apiKey)
	cfg.BaseURL = deepseekBaseURL
	client := goopenai.NewClientWithConfig(cfg)

	messages := toDeepSeekMessages(req)
	stream, err := client.CreateChatCompletionStream(ctx, goopenai.ChatCompletionRequest{
		Model:       req.Model,
		Messages:    messages,
		MaxTokens:   req.MaxTokens,
		Temperature: float32(req.Temperature),
		Stream:      true,
	})
	if err != nil {
		return nil, fmt.Errorf("deepseek stream: %w", err)
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
				events <- provider.StreamEvent{Error: fmt.Errorf("deepseek stream recv: %w", err)}
				return
			}
			if len(chunk.Choices) > 0 {
				delta := chunk.Choices[0].Delta
				if delta.Content != "" {
					events <- provider.StreamEvent{
						Delta: &provider.DeltaEvent{Content: delta.Content},
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

func (a *Adapter) ListModels(_ context.Context, _ string) ([]provider.ModelInfo, error) {
	return []provider.ModelInfo{
		{ID: "deepseek-chat", Name: "DeepSeek Chat", Provider: "deepseek", ContextLimit: 65536},
		{ID: "deepseek-reasoner", Name: "DeepSeek Reasoner", Provider: "deepseek", ContextLimit: 65536},
	}, nil
}

func (a *Adapter) ValidateKey(ctx context.Context, apiKey string) error {
	cfg := goopenai.DefaultConfig(apiKey)
	cfg.BaseURL = deepseekBaseURL
	client := goopenai.NewClientWithConfig(cfg)
	_, err := client.ListModels(ctx)
	return err
}

func toDeepSeekMessages(req *provider.ChatRequest) []goopenai.ChatCompletionMessage {
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
