package provider

import (
	"context"
	"errors"
	"reflect"
	"testing"
)

const routedKeyPool = `{"version":1,"keys":[{"id":"primary","name":"Primary","value":"key-a","enabled":true},{"id":"backup","name":"Backup","value":"key-b","enabled":true}]}`

type keyRoutedFakeAdapter struct {
	calls   []string
	failing map[string]bool
}

func (a *keyRoutedFakeAdapter) ID() string { return "custom" }
func (a *keyRoutedFakeAdapter) Chat(_ context.Context, _ *ChatRequest, key string) (*ChatResponse, error) {
	a.calls = append(a.calls, key)
	if a.failing[key] {
		return nil, errors.New("request failed")
	}
	return &ChatResponse{Content: key}, nil
}
func (a *keyRoutedFakeAdapter) ChatStream(_ context.Context, _ *ChatRequest, key string) (<-chan StreamEvent, error) {
	if a.failing[key] {
		return nil, errors.New("request failed")
	}
	events := make(chan StreamEvent)
	close(events)
	return events, nil
}
func (a *keyRoutedFakeAdapter) ListModels(_ context.Context, key string) ([]ModelInfo, error) {
	if a.failing[key] {
		return nil, errors.New("request failed")
	}
	return []ModelInfo{{ID: key}}, nil
}
func (a *keyRoutedFakeAdapter) ValidateKey(_ context.Context, key string) error {
	if a.failing[key] {
		return errors.New("request failed")
	}
	return nil
}

func TestParseAPIKeysKeepsLegacySingleKeyCompatibility(t *testing.T) {
	keys, err := ParseAPIKeys(" legacy-key ")
	if err != nil || !reflect.DeepEqual(keys, []string{"legacy-key"}) {
		t.Fatalf("keys = %v, err = %v", keys, err)
	}
}

func TestParseAPIKeysRejectsPoolWithoutEnabledKeys(t *testing.T) {
	_, err := ParseAPIKeys(`{"version":1,"keys":[{"id":"primary","value":"key-a","enabled":false}]}`)
	if err == nil {
		t.Fatal("expected disabled pool to fail")
	}
}

func TestAPIKeyRoutedAdapterFailoverUsesBackupAfterPrimaryFailure(t *testing.T) {
	inner := &keyRoutedFakeAdapter{failing: map[string]bool{}}
	adapter, err := NewAPIKeyRoutedAdapter("custom", RoutingFailover, inner)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := adapter.Chat(context.Background(), &ChatRequest{}, routedKeyPool); err != nil {
		t.Fatal(err)
	}
	inner.failing["key-a"] = true
	response, err := adapter.Chat(context.Background(), &ChatRequest{}, routedKeyPool)
	if err != nil || response.Content != "key-b" {
		t.Fatalf("response = %#v, err = %v", response, err)
	}
	if want := []string{"key-a", "key-a", "key-b"}; !reflect.DeepEqual(inner.calls, want) {
		t.Fatalf("calls = %v, want %v", inner.calls, want)
	}
}

func TestAPIKeyRoutedAdapterRoundRobinRotatesStartingKey(t *testing.T) {
	inner := &keyRoutedFakeAdapter{failing: map[string]bool{}}
	adapter, err := NewAPIKeyRoutedAdapter("custom", RoutingRoundRobin, inner)
	if err != nil {
		t.Fatal(err)
	}
	for range 4 {
		if _, err := adapter.Chat(context.Background(), &ChatRequest{}, routedKeyPool); err != nil {
			t.Fatal(err)
		}
	}
	if want := []string{"key-a", "key-b", "key-a", "key-b"}; !reflect.DeepEqual(inner.calls, want) {
		t.Fatalf("calls = %v, want %v", inner.calls, want)
	}
}
