package provider

import (
	"context"
	"errors"
	"reflect"
	"testing"
)

type routedFakeAdapter struct {
	id       string
	label    string
	calls    *[]string
	chatErr  error
	modelErr error
}

func (a *routedFakeAdapter) ID() string { return a.id }
func (a *routedFakeAdapter) Chat(_ context.Context, _ *ChatRequest, _ string) (*ChatResponse, error) {
	*a.calls = append(*a.calls, a.label)
	if a.chatErr != nil {
		return nil, a.chatErr
	}
	return &ChatResponse{Content: a.label}, nil
}
func (a *routedFakeAdapter) ChatStream(_ context.Context, _ *ChatRequest, _ string) (<-chan StreamEvent, error) {
	if a.chatErr != nil {
		return nil, a.chatErr
	}
	events := make(chan StreamEvent)
	close(events)
	return events, nil
}
func (a *routedFakeAdapter) ListModels(_ context.Context, _ string) ([]ModelInfo, error) {
	if a.modelErr != nil {
		return nil, a.modelErr
	}
	return []ModelInfo{{ID: a.label}}, nil
}
func (a *routedFakeAdapter) ValidateKey(_ context.Context, _ string) error {
	return a.modelErr
}

func TestRoutedAdapterFailoverUsesPrimaryUntilItFails(t *testing.T) {
	calls := []string{}
	primary := &routedFakeAdapter{id: "custom", label: "primary", calls: &calls}
	backup := &routedFakeAdapter{id: "custom", label: "backup", calls: &calls}
	adapter, err := NewRoutedAdapter("custom", RoutingFailover, []Adapter{primary, backup})
	if err != nil {
		t.Fatal(err)
	}

	first, err := adapter.Chat(context.Background(), &ChatRequest{}, "key")
	if err != nil || first.Content != "primary" {
		t.Fatalf("expected primary response, got %#v, %v", first, err)
	}
	primary.chatErr = errors.New("offline")
	second, err := adapter.Chat(context.Background(), &ChatRequest{}, "key")
	if err != nil || second.Content != "backup" {
		t.Fatalf("expected backup response, got %#v, %v", second, err)
	}
	if want := []string{"primary", "primary", "backup"}; !reflect.DeepEqual(calls, want) {
		t.Fatalf("calls = %v, want %v", calls, want)
	}
}

func TestRoutedAdapterRoundRobinRotatesStartingEndpoint(t *testing.T) {
	calls := []string{}
	first := &routedFakeAdapter{id: "custom", label: "a", calls: &calls}
	second := &routedFakeAdapter{id: "custom", label: "b", calls: &calls}
	adapter, err := NewRoutedAdapter("custom", RoutingRoundRobin, []Adapter{first, second})
	if err != nil {
		t.Fatal(err)
	}

	for range 4 {
		if _, err := adapter.Chat(context.Background(), &ChatRequest{}, "key"); err != nil {
			t.Fatal(err)
		}
	}
	if want := []string{"a", "b", "a", "b"}; !reflect.DeepEqual(calls, want) {
		t.Fatalf("calls = %v, want %v", calls, want)
	}
}
