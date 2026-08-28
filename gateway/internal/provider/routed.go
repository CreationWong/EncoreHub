// Package provider composes protocol adapters with endpoint routing.
package provider

import (
	"context"
	"fmt"
	"sync/atomic"
)

// RoutedAdapter distributes requests across adapters for endpoints belonging
// to one provider profile. It retries only when an adapter fails before a
// response (or stream) is established; an in-progress stream is never replayed.
type RoutedAdapter struct {
	id       string
	strategy string
	adapters []Adapter
	next     atomic.Uint64
}

func NewRoutedAdapter(id, strategy string, adapters []Adapter) (*RoutedAdapter, error) {
	if len(adapters) == 0 {
		return nil, fmt.Errorf("provider %q has no enabled endpoints", id)
	}
	if strategy == "" {
		strategy = RoutingFailover
	}
	if strategy != RoutingFailover && strategy != RoutingRoundRobin {
		return nil, fmt.Errorf("provider %q has unknown routing strategy %q", id, strategy)
	}
	return &RoutedAdapter{id: id, strategy: strategy, adapters: adapters}, nil
}

func (a *RoutedAdapter) ID() string { return a.id }

func (a *RoutedAdapter) order() []int {
	start := 0
	if a.strategy == RoutingRoundRobin {
		start = int((a.next.Add(1) - 1) % uint64(len(a.adapters)))
	}
	order := make([]int, len(a.adapters))
	for i := range order {
		order[i] = (start + i) % len(a.adapters)
	}
	return order
}

// exhausted returns a redacted routing error while retaining a safe HTTP status.
func (a *RoutedAdapter) exhausted(operation string, cause error) error {
	message := fmt.Sprintf("provider %q %s failed across %d endpoints", a.id, operation, len(a.adapters))
	if status := UpstreamHTTPStatus(cause); status > 0 {
		return fmt.Errorf("%s: %w", message, NewUpstreamHTTPError(status))
	}
	return fmt.Errorf("%s", message)
}

func (a *RoutedAdapter) Chat(ctx context.Context, req *ChatRequest, apiKey string) (*ChatResponse, error) {
	var upstreamErr error
	for _, index := range a.order() {
		response, err := a.adapters[index].Chat(ctx, req, apiKey)
		if err == nil {
			return response, nil
		}
		if UpstreamHTTPStatus(err) > 0 {
			upstreamErr = err
		}
	}
	return nil, a.exhausted("chat", upstreamErr)
}

func (a *RoutedAdapter) ChatStream(ctx context.Context, req *ChatRequest, apiKey string) (<-chan StreamEvent, error) {
	var upstreamErr error
	for _, index := range a.order() {
		events, err := a.adapters[index].ChatStream(ctx, req, apiKey)
		if err == nil {
			return events, nil
		}
		if UpstreamHTTPStatus(err) > 0 {
			upstreamErr = err
		}
	}
	return nil, a.exhausted("stream", upstreamErr)
}

// Embed applies the same endpoint routing policy as other provider operations.
func (a *RoutedAdapter) Embed(ctx context.Context, req *EmbeddingRequest, apiKey string) (*EmbeddingResponse, error) {
	var upstreamErr error
	for _, index := range a.order() {
		embedder, supported := a.adapters[index].(EmbeddingAdapter)
		if !supported {
			continue
		}
		response, err := embedder.Embed(ctx, req, apiKey)
		if err == nil {
			return response, nil
		}
		if UpstreamHTTPStatus(err) > 0 {
			upstreamErr = err
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
	}
	return nil, a.exhausted("embeddings", upstreamErr)
}

func (a *RoutedAdapter) ListModels(ctx context.Context, apiKey string) ([]ModelInfo, error) {
	var upstreamErr error
	for _, index := range a.order() {
		models, err := a.adapters[index].ListModels(ctx, apiKey)
		if err == nil {
			return models, nil
		}
		if UpstreamHTTPStatus(err) > 0 {
			upstreamErr = err
		}
	}
	return nil, a.exhausted("model listing", upstreamErr)
}

func (a *RoutedAdapter) ValidateKey(ctx context.Context, apiKey string) error {
	var upstreamErr error
	for _, index := range a.order() {
		err := a.adapters[index].ValidateKey(ctx, apiKey)
		if err == nil {
			return nil
		}
		if UpstreamHTTPStatus(err) > 0 {
			upstreamErr = err
		}
	}
	return a.exhausted("key validation", upstreamErr)
}
