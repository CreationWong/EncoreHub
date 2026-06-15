// Package provider defines the unified AI provider adapter interface.
//
// Each AI provider (OpenAI, Anthropic, Gemini, etc.) implements this interface
// to translate between EncoreHub's unified format and the provider's native API.
package provider

import (
	"context"
)

// Message represents a single chat message in unified format.
type Message struct {
	Role    string `json:"role"`    // "user", "assistant", "system", "tool"
	Content string `json:"content"`
}

// ChatRequest is the unified request format sent to AI providers.
type ChatRequest struct {
	Model       string    `json:"model"`
	Messages    []Message `json:"messages"`
	Stream      bool      `json:"stream"`
	MaxTokens   int       `json:"max_tokens,omitempty"`
	Temperature float32   `json:"temperature,omitempty"`
	SystemPrompt string   `json:"system_prompt,omitempty"`
}

// ChatResponse is the unified (non-streaming) response.
type ChatResponse struct {
	Content      string `json:"content"`
	FinishReason string `json:"finish_reason"`
	InputTokens  int    `json:"input_tokens"`
	OutputTokens int    `json:"output_tokens"`
	Model        string `json:"model"`
}

// DeltaEvent is emitted during streaming.
type DeltaEvent struct {
	Content      string `json:"content"`
	FinishReason string `json:"finish_reason,omitempty"`
}

// UsageEvent is emitted at the end of a stream.
type UsageEvent struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
}

// ModelInfo describes an available model.
type ModelInfo struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Provider     string `json:"provider"`
	ContextLimit int    `json:"context_limit"`
}

// Adapter is the interface all AI providers must implement.
type Adapter interface {
	// ID returns the provider identifier (e.g. "openai", "anthropic").
	ID() string

	// Chat sends a non-streaming chat request and returns the full response.
	Chat(ctx context.Context, req *ChatRequest, apiKey string) (*ChatResponse, error)

	// ChatStream sends a streaming chat request and returns a channel of events.
	ChatStream(ctx context.Context, req *ChatRequest, apiKey string) (<-chan StreamEvent, error)

	// ListModels returns available models for this provider.
	ListModels(ctx context.Context, apiKey string) ([]ModelInfo, error)

	// ValidateKey checks if the given API key is valid.
	ValidateKey(ctx context.Context, apiKey string) error
}

// StreamEvent wraps a streaming event — either a content delta, usage info, or error.
type StreamEvent struct {
	Delta *DeltaEvent
	Usage *UsageEvent
	Error error
}
