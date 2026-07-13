package engine

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func TestClientAddsInternalBearerToEveryRequestPath(t *testing.T) {
	t.Setenv("ENCOREHUB_AUTH_TOKEN", "unrelated-external-token")

	var (
		mu      sync.Mutex
		headers []string
	)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		headers = append(headers, r.Header.Get("Authorization"))
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/api/secrets/openai" {
			_, _ = io.WriteString(w, `{"key":"sk-test"}`)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(server.Close)

	client := NewClient(server.URL, "internal-engine-token")
	if err := client.Health(context.Background()); err != nil {
		t.Fatalf("health: %v", err)
	}
	key, ok, err := client.GetSecret(context.Background(), "openai")
	if err != nil {
		t.Fatalf("get secret: %v", err)
	}
	if !ok || key != "sk-test" {
		t.Fatalf("unexpected secret response: key=%q ok=%v", key, ok)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(headers) != 2 {
		t.Fatalf("captured %d requests, want 2", len(headers))
	}
	for _, got := range headers {
		if got != "Bearer internal-engine-token" {
			t.Errorf("authorization = %q", got)
		}
	}
}

func TestClientWithoutInternalTokenFailsClosedBeforeNetwork(t *testing.T) {
	hits := 0
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		hits++
	}))
	t.Cleanup(server.Close)

	client := NewClient(server.URL, "")
	err := client.Health(context.Background())
	if err == nil || !strings.Contains(err.Error(), "not configured") {
		t.Fatalf("expected configuration error, got %v", err)
	}
	if hits != 0 {
		t.Fatalf("request reached Engine without a token: hits=%d", hits)
	}
}
