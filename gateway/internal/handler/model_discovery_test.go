package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestDiscoverEndpointModelsOpenAIUsesBearerKey(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer secret-key" {
			t.Fatalf("authorization = %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"model-a","name":"Model A"},{"id":"model-a"},{"id":"model-b"}]}`))
	}))
	defer server.Close()

	handler := &ProviderHandler{client: server.Client()}
	models, category := handler.discoverEndpointModels(
		context.Background(), "custom", "openai", server.URL+"/v1", []string{"secret-key"},
	)
	if category != "" {
		t.Fatalf("category = %q", category)
	}
	ids := []string{models[0].ID, models[1].ID}
	if want := []string{"model-a", "model-b"}; !reflect.DeepEqual(ids, want) {
		t.Fatalf("models = %v, want %v", ids, want)
	}
}

func TestDiscoverEndpointModelsAnthropicUsesAPIKeyHeader(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("x-api-key"); got != "anthropic-key" {
			t.Fatalf("x-api-key = %q", got)
		}
		if got := r.Header.Get("anthropic-version"); got == "" {
			t.Fatal("missing anthropic-version")
		}
		_, _ = w.Write([]byte(`{"data":[{"id":"claude-test","display_name":"Claude Test"}]}`))
	}))
	defer server.Close()

	handler := &ProviderHandler{client: server.Client()}
	models, category := handler.discoverEndpointModels(
		context.Background(), "anthropic", "anthropic", server.URL, []string{"anthropic-key"},
	)
	if category != "" || len(models) != 1 || models[0].Name != "Claude Test" {
		t.Fatalf("models = %#v, category = %q", models, category)
	}
}

func TestParseDiscoveredModelsSupportsCommonResponseShapes(t *testing.T) {
	for name, body := range map[string]string{
		"models array": `{"models":["model-a",{"model":"model-b"}]}`,
		"bare array":   `[{"id":"model-a"},{"name":"model-b"}]`,
	} {
		t.Run(name, func(t *testing.T) {
			models, ok := parseDiscoveredModels([]byte(body), "custom")
			if !ok || len(models) != 2 {
				t.Fatalf("models = %#v, ok = %v", models, ok)
			}
		})
	}
}

func TestDiscoverEndpointModelsClassifiesRemoteFailureWithoutBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"secret provider response"}`))
	}))
	defer server.Close()

	handler := &ProviderHandler{client: server.Client()}
	models, category := handler.discoverEndpointModels(
		context.Background(), "custom", "openai", server.URL, []string{"wrong-key"},
	)
	if models != nil || category != "authentication_failed" {
		t.Fatalf("models = %#v, category = %q", models, category)
	}
}

func TestDiscoverEndpointModelsTriesBackupAPIKey(t *testing.T) {
	var authorizations []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authorizations = append(authorizations, r.Header.Get("Authorization"))
		if r.Header.Get("Authorization") != "Bearer backup-key" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_, _ = w.Write([]byte(`{"data":[{"id":"model-a"}]}`))
	}))
	defer server.Close()

	handler := &ProviderHandler{client: server.Client()}
	models, category := handler.discoverEndpointModels(
		context.Background(),
		"custom",
		"openai",
		server.URL,
		[]string{"primary-key", "backup-key"},
	)
	if category != "" || len(models) != 1 {
		t.Fatalf("models = %#v, category = %q", models, category)
	}
	if want := []string{"Bearer primary-key", "Bearer backup-key"}; !reflect.DeepEqual(authorizations, want) {
		t.Fatalf("authorizations = %v, want %v", authorizations, want)
	}
}
