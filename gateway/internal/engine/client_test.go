package engine

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"com.0d000721.encorehub/gateway/internal/search"
)

func TestNetworkFetchMethodsPreserveTrustMode(t *testing.T) {
	var requests []networkFetchRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/network/fetch" {
			t.Fatalf("request = %s %s", r.Method, r.URL.Path)
		}
		var request networkFetchRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		requests = append(requests, request)
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"status":200,"final_url":"https://example.com/final","content_type":"text/html","body":"page","backend":"curl"}`)
	}))
	t.Cleanup(server.Close)

	client := NewClient(server.URL, "internal-engine-token")
	status, _, _, body, err := client.FetchSearchURL(
		context.Background(), "https://search.example", map[string]string{"Authorization": "secret"}, 1024, search.FetchPolicyPublicAPI,
	)
	if err != nil || status != http.StatusOK || string(body) != "page" {
		t.Fatalf("search fetch = status %d body %q err %v", status, body, err)
	}
	if _, err := client.FetchPublicURL(context.Background(), "https://example.com", 2048); err != nil {
		t.Fatalf("public fetch: %v", err)
	}
	_, _, _, _, err = client.FetchSearchURL(context.Background(), "http://127.0.0.1:8888/search", nil, 1024, search.FetchPolicyConfiguredAPI)
	if err != nil {
		t.Fatalf("configured search fetch: %v", err)
	}
	if len(requests) != 3 || requests[0].Purpose != "search_provider" ||
		requests[0].Headers["Authorization"] != "secret" || requests[0].TimeoutMS != 15_000 ||
		requests[1].Purpose != "public_page" || requests[1].TimeoutMS != 10_000 ||
		len(requests[1].Headers) != 0 || !requests[1].Extract || requests[2].Purpose != "configured_search_provider" {
		t.Fatalf("unexpected trust modes: %#v", requests)
	}
}

func TestBeginTurnReplacingSendsReplacementID(t *testing.T) {
	var body map[string]string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/conversations/c1/turns" {
			t.Fatalf("request = %s %s", r.Method, r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"id":"turn-2","role":"user","content":"revised","status":"pending"}`)
	}))
	t.Cleanup(server.Close)

	client := NewClient(server.URL, "internal-engine-token")
	if _, err := client.BeginTurnReplacing(context.Background(), "c1", "revised", "turn-1"); err != nil {
		t.Fatalf("begin replacement turn: %v", err)
	}
	if body["content"] != "revised" || body["replace_message_id"] != "turn-1" {
		t.Fatalf("request body = %#v", body)
	}
}

func TestAttachmentDataURLRejectsEngineErrorResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = io.WriteString(w, "{\"error\":\"missing\"}")
	}))
	t.Cleanup(server.Close)

	client := NewClient(server.URL, "internal-engine-token")
	_, err := client.AttachmentDataURL(context.Background(), "c1", Attachment{
		ID: "a1", MimeType: "image/png",
	})
	if ErrorStatus(err) != http.StatusNotFound {
		t.Fatalf("attachment error = %v", err)
	}
}

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
		if r.URL.Path == "/health/ready" {
			_, _ = io.WriteString(w, `{"status":"ok","database":{"ok":true},"version_info":{"component":"engine","version":"V0.1.0.0","build_id":"260813600474","compatibility":{"gateway":{"min":"V0.1.0.0","max_exclusive":"V0.2.0.0"},"frontend":{"min":"V0.1.0.0","max_exclusive":"V0.2.0.0"}}}}`)
			return
		}
		if r.URL.Path == "/api/secrets/openai" {
			_, _ = io.WriteString(w, `{"key":"sk-test"}`)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(server.Close)

	client := NewClient(server.URL, "internal-engine-token")
	if err := client.Readiness(context.Background()); err != nil {
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
	err := client.Readiness(context.Background())
	if err == nil || !strings.Contains(err.Error(), "not configured") {
		t.Fatalf("expected configuration error, got %v", err)
	}
	if hits != 0 {
		t.Fatalf("request reached Engine without a token: hits=%d", hits)
	}
}

func TestReadinessRejectsDatabaseFalseOnHTTP200(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/health/ready" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"status":"not_ready","database":{"ok":false}}`)
	}))
	t.Cleanup(server.Close)

	client := NewClient(server.URL, "internal-engine-token")
	err := client.Readiness(context.Background())
	if err == nil || !strings.Contains(err.Error(), "database") {
		t.Fatalf("expected database readiness error, got %v", err)
	}
}

func TestReadinessWithCompatibilityRejectsIncompatibleEngine(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/health/ready" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"status":"ok","database":{"ok":true},"version_info":{"component":"engine","version":"V0.2.0.0","build_id":"260813600474","compatibility":{"gateway":{"min":"V0.2.0.0","max_exclusive":"V0.3.0.0"},"frontend":{"min":"V0.2.0.0","max_exclusive":"V0.3.0.0"}}}}`)
	}))
	t.Cleanup(server.Close)

	client := NewClient(server.URL, "internal-engine-token")
	_, err := client.ReadinessWithCompatibility(context.Background())
	var compatibilityError *CompatibilityError
	if !errors.As(err, &compatibilityError) {
		t.Fatalf("expected CompatibilityError, got %v", err)
	}
}
