package provider

import (
	"context"
	"fmt"
	"sync/atomic"
)

// APIKeyRoutedAdapter applies a provider's key selection policy around its
// endpoint adapter. Endpoint and key routing remain independent and compose
// without placing secret values in ProviderProfile.
type APIKeyRoutedAdapter struct {
	id       string
	strategy string
	adapter  Adapter
	next     atomic.Uint64
}

func NewAPIKeyRoutedAdapter(id, strategy string, adapter Adapter) (*APIKeyRoutedAdapter, error) {
	if adapter == nil {
		return nil, fmt.Errorf("provider %q has no adapter", id)
	}
	if strategy == "" {
		strategy = RoutingFailover
	}
	if strategy != RoutingFailover && strategy != RoutingRoundRobin {
		return nil, fmt.Errorf("provider %q has unknown API key routing strategy %q", id, strategy)
	}
	return &APIKeyRoutedAdapter{id: id, strategy: strategy, adapter: adapter}, nil
}

func (a *APIKeyRoutedAdapter) ID() string { return a.id }

func (a *APIKeyRoutedAdapter) keys(raw string) ([]string, error) {
	keys, err := ParseAPIKeys(raw)
	if err != nil {
		return nil, fmt.Errorf("provider %q has an invalid API key pool", a.id)
	}
	if len(keys) <= 1 || a.strategy == RoutingFailover {
		return keys, nil
	}
	start := int((a.next.Add(1) - 1) % uint64(len(keys)))
	ordered := make([]string, len(keys))
	for index := range ordered {
		ordered[index] = keys[(start+index)%len(keys)]
	}
	return ordered, nil
}

func (a *APIKeyRoutedAdapter) exhausted(operation string, count int) error {
	return fmt.Errorf("provider %q %s failed across %d API keys", a.id, operation, count)
}

func (a *APIKeyRoutedAdapter) Chat(ctx context.Context, req *ChatRequest, raw string) (*ChatResponse, error) {
	keys, err := a.keys(raw)
	if err != nil {
		return nil, err
	}
	for _, key := range keys {
		response, requestErr := a.adapter.Chat(ctx, req, key)
		if requestErr == nil {
			return response, nil
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
	}
	return nil, a.exhausted("chat", len(keys))
}

func (a *APIKeyRoutedAdapter) ChatStream(ctx context.Context, req *ChatRequest, raw string) (<-chan StreamEvent, error) {
	keys, err := a.keys(raw)
	if err != nil {
		return nil, err
	}
	for _, key := range keys {
		events, requestErr := a.adapter.ChatStream(ctx, req, key)
		if requestErr == nil {
			return events, nil
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
	}
	return nil, a.exhausted("stream", len(keys))
}

func (a *APIKeyRoutedAdapter) ListModels(ctx context.Context, raw string) ([]ModelInfo, error) {
	keys, err := a.keys(raw)
	if err != nil {
		return nil, err
	}
	for _, key := range keys {
		models, requestErr := a.adapter.ListModels(ctx, key)
		if requestErr == nil {
			return models, nil
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
	}
	return nil, a.exhausted("model listing", len(keys))
}

func (a *APIKeyRoutedAdapter) ValidateKey(ctx context.Context, raw string) error {
	keys, err := a.keys(raw)
	if err != nil {
		return err
	}
	for _, key := range keys {
		if requestErr := a.adapter.ValidateKey(ctx, key); requestErr == nil {
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
	}
	return a.exhausted("key validation", len(keys))
}
