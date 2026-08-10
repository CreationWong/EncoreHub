package handler

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"com.0d000721.encorehub/gateway/internal/engine"
)

func TestResolveWebSearchProviderUsesConfiguredSearXNGEndpoint(t *testing.T) {
	var networkRequest struct {
		URL     string `json:"url"`
		Purpose string `json:"purpose"`
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/config/web_search_settings":
			_, _ = io.WriteString(w, `{"enabled":true,"provider":"searxng","max_results":3,"searxng":{"endpoint":"http://127.0.0.1:8888"}}`)
		case "/api/network/fetch":
			if err := json.NewDecoder(r.Body).Decode(&networkRequest); err != nil {
				t.Fatalf("decode: %v", err)
			}
			_, _ = io.WriteString(w, `{"status":200,"final_url":"http://127.0.0.1:8888/search","content_type":"application/json","body":"{\"results\":[{\"title\":\"EncoreHub\",\"url\":\"https://example.com\",\"content\":\"Result\"}]}","backend":"curl"}`)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)

	provider, settings, err := resolveWebSearchProvider(context.Background(), engine.NewClient(server.URL, "test-token"), "")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	response, err := provider.Search(context.Background(), "desktop AI", settings.MaxResults)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if provider.Name() != "searxng" || settings.MaxResults != 3 || len(response.Results) != 1 {
		t.Fatalf("unexpected provider response: provider=%s settings=%+v response=%+v", provider.Name(), settings, response)
	}
	if !strings.Contains(networkRequest.URL, "q=desktop+AI") || networkRequest.Purpose != "configured_search_provider" {
		t.Fatalf("configured endpoint did not use private-network policy: %+v", networkRequest)
	}
}

func TestResolveWebSearchProviderUsesOpenSERPSettings(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/api/config/web_search_settings" {
			_, _ = io.WriteString(w, `{"provider":"openserp","openserp":{"endpoint":"http://localhost:7000","engine":"google","engines":"bing,duckduckgo"}}`)
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(server.Close)
	provider, settings, err := resolveWebSearchProvider(context.Background(), engine.NewClient(server.URL, "token"), "")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if provider.Name() != "openserp" || settings.OpenSERP.Engine != "google" || settings.OpenSERP.Engines != "bing,duckduckgo" {
		t.Fatalf("settings were not preserved: %+v", settings)
	}
}

func TestResolveWebSearchProviderRejectsMissingConfiguredEndpoint(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"provider":"searxng"}`)
	}))
	t.Cleanup(server.Close)
	if _, _, err := resolveWebSearchProvider(context.Background(), engine.NewClient(server.URL, "token"), ""); err == nil {
		t.Fatal("missing SearXNG endpoint should fail")
	}
}
