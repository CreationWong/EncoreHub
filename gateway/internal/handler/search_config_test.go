package handler

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	// Internal packages use EncoreHub's stable reverse-domain namespace.
	"com.0d000721.encorehub/gateway/internal/engine"
)

func TestResolveWebSearchProviderUsesEngineConfigAndSecret(t *testing.T) {
	var customRequest *http.Request
	customServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		customRequest = r.Clone(r.Context())
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"data":{"items":[{"heading":"EncoreHub","link":"https://example.com","summary":"Result"}]}}`)
	}))
	t.Cleanup(customServer.Close)

	engineServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Fatalf("authorization = %q", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/config/web_search_settings":
			_, _ = io.WriteString(w, `{"provider":"custom","max_results":3,"custom":{"name":"Internal index","endpoint":"`+customServer.URL+`","query_parameter":"query","limit_parameter":"limit","api_key_header":"X-Search-Key","api_key_prefix":"Token ","results_path":"data.items","title_path":"heading","url_path":"link","snippet_path":"summary"}}`)
		case "/api/secrets/system.search.custom":
			_, _ = io.WriteString(w, `{"key":"secret"}`)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(engineServer.Close)

	provider, settings, err := resolveWebSearchProvider(
		context.Background(),
		engine.NewClient(engineServer.URL, "test-token"),
		"",
	)
	if err != nil {
		t.Fatalf("resolve provider: %v", err)
	}
	if provider.Name() != "Internal index" || settings.MaxResults != 3 {
		t.Fatalf("unexpected resolution: provider=%q max=%d", provider.Name(), settings.MaxResults)
	}

	response, err := provider.Search(context.Background(), "desktop AI", settings.MaxResults)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(response.Results) != 1 || response.Results[0].Title != "EncoreHub" {
		t.Fatalf("results = %+v", response.Results)
	}
	if customRequest == nil || customRequest.URL.Query().Get("query") != "desktop AI" ||
		customRequest.URL.Query().Get("limit") != "3" ||
		customRequest.Header.Get("X-Search-Key") != "Token secret" {
		t.Fatalf("custom request was not configured correctly: %+v", customRequest)
	}
}

func TestResolveWebSearchProviderRejectsMissingCredentials(t *testing.T) {
	engineServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/config/web_search_settings":
			_, _ = io.WriteString(w, `{"provider":"bing"}`)
		case "/api/secrets/system.search.bing":
			http.NotFound(w, r)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(engineServer.Close)

	_, _, err := resolveWebSearchProvider(
		context.Background(),
		engine.NewClient(engineServer.URL, "test-token"),
		"",
	)
	if err == nil {
		t.Fatal("missing Bing key should fail instead of switching providers")
	}
}
