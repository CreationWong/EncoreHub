package handler

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"com.0d000721.encorehub/gateway/internal/engine"
	"com.0d000721.encorehub/gateway/internal/search"
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

func TestResolveWebSearchProviderMigratesDuckDuckGoHTMLToCombinedProvider(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/api/config/web_search_settings" {
			_, _ = io.WriteString(w, `{"enabled":true,"provider":"duckduckgo_html","max_results":4}`)
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(server.Close)

	provider, settings, err := resolveWebSearchProvider(
		context.Background(),
		engine.NewClient(server.URL, "token"),
		"",
	)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if provider.Name() != "duckduckgo" || settings.Provider != "duckduckgo" || settings.MaxResults != 4 {
		t.Fatalf("legacy DuckDuckGo HTML settings were not migrated: provider=%s settings=%+v", provider.Name(), settings)
	}
}

func TestResolveWebSearchProviderUsesExaFreeModeWithoutSecret(t *testing.T) {
	var networkRequest struct {
		URL    string `json:"url"`
		Method string `json:"method"`
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/config/web_search_settings":
			_, _ = io.WriteString(w, `{"enabled":true,"provider":"exa","max_results":3,"exa":{"mode":"free"}}`)
		case "/api/network/fetch":
			if err := json.NewDecoder(r.Body).Decode(&networkRequest); err != nil {
				t.Fatalf("decode: %v", err)
			}
			_, _ = io.WriteString(w, `{"status":200,"final_url":"https://mcp.exa.ai/mcp","content_type":"application/json","body":"{\"jsonrpc\":\"2.0\",\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"Title: Hit\\nURL: https://example.com/exa\\nSnippet: Result\"}]}}","backend":"curl"}`)
		case "/api/secrets/web_search_exa":
			t.Fatal("free Exa mode must not load an API key")
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)

	provider, settings, err := resolveWebSearchProvider(context.Background(), engine.NewClient(server.URL, "token"), "")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	response, err := provider.Search(context.Background(), "exa papers", settings.MaxResults)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if provider.Name() != "exa" || settings.Exa.Mode != search.ExaModeFree || len(response.Results) != 1 {
		t.Fatalf("unexpected free Exa response: provider=%s settings=%+v results=%+v", provider.Name(), settings, response.Results)
	}
	if networkRequest.URL != "https://mcp.exa.ai/mcp" || networkRequest.Method != "POST" {
		t.Fatalf("free Exa did not use hosted MCP: %+v", networkRequest)
	}
}

func TestResolveWebSearchProviderUsesExaAPIKeyFromSecrets(t *testing.T) {
	var networkRequest struct {
		URL     string            `json:"url"`
		Method  string            `json:"method"`
		Headers map[string]string `json:"headers"`
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/config/web_search_settings":
			_, _ = io.WriteString(w, `{"provider":"exa","exa":{"mode":"api_key"}}`)
		case "/api/secrets/web_search_exa":
			_, _ = io.WriteString(w, `{"key":"exa-secret"}`)
		case "/api/network/fetch":
			if err := json.NewDecoder(r.Body).Decode(&networkRequest); err != nil {
				t.Fatalf("decode: %v", err)
			}
			_, _ = io.WriteString(w, `{"status":200,"final_url":"https://api.exa.ai/search","content_type":"application/json","body":"{\"results\":[{\"title\":\"Keyed\",\"url\":\"https://example.com/keyed\",\"text\":\"Snippet\"}]}","backend":"curl"}`)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)

	provider, settings, err := resolveWebSearchProvider(context.Background(), engine.NewClient(server.URL, "token"), "exa")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	response, err := provider.Search(context.Background(), "keyed query", 1)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if settings.Exa.Mode != search.ExaModeAPIKey || len(response.Results) != 1 || response.Results[0].Title != "Keyed" {
		t.Fatalf("unexpected keyed Exa response: %+v %+v", settings, response)
	}
	if networkRequest.URL != "https://api.exa.ai/search" || networkRequest.Headers["x-api-key"] != "exa-secret" {
		t.Fatalf("keyed Exa did not use REST with the stored key: %+v", networkRequest)
	}
}

func TestResolveWebSearchProviderRejectsExaAPIKeyModeWithoutSecret(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/api/config/web_search_settings" {
			_, _ = io.WriteString(w, `{"provider":"exa","exa":{"mode":"api_key"}}`)
			return
		}
		if r.URL.Path == "/api/secrets/web_search_exa" {
			w.WriteHeader(http.StatusNotFound)
			_, _ = io.WriteString(w, `{"error":"no key for provider"}`)
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(server.Close)
	if _, _, err := resolveWebSearchProvider(context.Background(), engine.NewClient(server.URL, "token"), ""); err == nil {
		t.Fatal("missing Exa API key should fail")
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

func TestExecuteWebSearchUsesHTMLWhenDuckDuckGoInstantAnswerIsEmpty(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/config/web_search_settings":
			_, _ = io.WriteString(w, `{"enabled":true,"provider":"duckduckgo","max_results":5}`)
		case "/api/network/fetch":
			requests.Add(1)
			var request struct {
				URL string `json:"url"`
			}
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Fatalf("decode network request: %v", err)
			}
			if strings.Contains(request.URL, "api.duckduckgo.com") {
				writeTestJSON(w, http.StatusOK, map[string]any{
					"status": 200, "final_url": request.URL, "content_type": "application/json", "body": `{}`, "backend": "curl",
				})
				return
			}
			writeTestJSON(w, http.StatusOK, map[string]any{
				"status": 200, "final_url": request.URL, "content_type": "text/html",
				"body":    `<div class="result"><a class="result__a" href="https://example.com/anime">2026 anime</a><div class="result__snippet">Summer list</div></div>`,
				"backend": "curl",
			})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)

	response, err := executeWebSearch(
		context.Background(),
		engine.NewClient(server.URL, "token"),
		"",
		"2026下半年新番",
	)
	if err != nil {
		t.Fatalf("combined DuckDuckGo search failed: %v", err)
	}
	if len(response.Results) != 1 || response.Results[0].Kind != search.ResultKindWeb ||
		response.Results[0].URL != "https://example.com/anime" {
		t.Fatalf("HTML result was not preserved: %+v", response)
	}
	if requests.Load() != 2 {
		t.Fatalf("DuckDuckGo request count = %d, want HTML and Instant Answer", requests.Load())
	}
}
