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
	Role    string `json:"role"` // "user", "assistant", "system", "tool"
	Content string `json:"content"`
}

// ChatRequest is the unified request format sent to AI providers.
type ChatRequest struct {
	Model               string    `json:"model"`
	Messages            []Message `json:"messages"`
	Stream              bool      `json:"stream"`
	MaxTokens           int       `json:"max_tokens,omitempty"`
	MaxCompletionTokens int       `json:"max_completion_tokens,omitempty"`
	Temperature         float32   `json:"temperature,omitempty"`
	TopP                float32   `json:"top_p,omitempty"`
	FrequencyPenalty    float32   `json:"frequency_penalty,omitempty"`
	PresencePenalty     float32   `json:"presence_penalty,omitempty"`
	Stop                []string  `json:"stop,omitempty"`
	Seed                *int      `json:"seed,omitempty"`
	SystemPrompt        string    `json:"system_prompt,omitempty"`
	// JSONMode enables OpenAI's JSON mode (response_format: {"type": "json_object"}).
	// The system prompt should instruct the model to produce JSON.
	JSONMode bool `json:"json_mode,omitempty"`
	// ReasoningEffort for o-series / reasoning models ("low", "medium", "high").
	ReasoningEffort string `json:"reasoning_effort,omitempty"`
	// TopK for Claude-compatible nucleus sampling (Claude-specific).
	TopK int `json:"top_k,omitempty"`
	// ThinkingBudget enables Claude's extended thinking. Set to >=1024 to enable;
	// the tokens consumed count against MaxTokens. Ignored by non-Claude adapters.
	ThinkingBudget int `json:"thinking_budget,omitempty"`
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

// ReasoningEvent carries a chunk of the model's chain-of-thought (DeepSeek
// `reasoning_content` / Anthropic `thinking`), streamed separately from the
// visible answer.
type ReasoningEvent struct {
	Content string `json:"content"`
}

// ToolCallEvent announces a tool invocation the model requested. During
// streaming the arguments may arrive incrementally; the gateway aggregates
// fragments by Index before persisting.
type ToolCallEvent struct {
	Index     int    `json:"index"`
	ID        string `json:"id,omitempty"`
	Name      string `json:"name,omitempty"`
	Arguments string `json:"arguments,omitempty"`
}

// ToolResultEvent carries the output of an executed tool call. EncoreHub does
// not execute tools yet, so this is currently emitted only by adapters that
// receive tool results inline; reserved for the future tool executor.
type ToolResultEvent struct {
	ID     string `json:"id"`
	Result string `json:"result"`
	Status string `json:"status"` // "success" | "error"
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

// StreamEvent wraps a streaming event — a content delta, reasoning chunk, tool
// call, tool result, usage info, or error. Exactly one field is non-nil.
type StreamEvent struct {
	Delta      *DeltaEvent
	Reasoning  *ReasoningEvent
	ToolCall   *ToolCallEvent
	ToolResult *ToolResultEvent
	Usage      *UsageEvent
	Error      error
}
