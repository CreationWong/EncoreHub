package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"com.0d000721.encorehub/gateway/internal/diagnostics"
	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

func TestProviderHandlerDiscoveryEmitsRestrictedCommunicationTrace(t *testing.T) {
	diagnostics.SetEnabled(false)
	var output bytes.Buffer
	previousLogger := log.Logger
	log.Logger = zerolog.New(&output)
	t.Cleanup(func() { log.Logger = previousLogger })

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"data":[{"id":"model-a"}]}`))
	}))
	defer server.Close()

	handler := NewProviderHandler(nil, nil)
	models, category := handler.discoverEndpointModels(
		context.Background(), "ps", "openai", server.URL, []string{"private-key"},
	)
	if category != "" || len(models) != 1 {
		t.Fatalf("models = %#v, category = %q", models, category)
	}
	logged := output.String()
	if !strings.Contains(logged, "restricted communication trace") || !strings.Contains(logged, server.URL) {
		t.Fatalf("provider discovery did not emit a communication trace: %s", logged)
	}
	if strings.Contains(logged, "private-key") {
		t.Fatalf("provider discovery trace leaked credentials: %s", logged)
	}
}

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
		if r.URL.Path != "/api/anthropic/v1/models" {
			t.Fatalf("path = %q", r.URL.Path)
		}
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
		context.Background(), "anthropic", "anthropic", server.URL+"/api/anthropic", []string{"anthropic-key"},
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

func TestParseDiscoveredModelsPreservesProviderMetadata(t *testing.T) {
	body := []byte(`{"data":[{
		"id":"anthropic/claude-sonnet-4.5",
		"display_name":"Anthropic: Claude Sonnet 4.5",
		"owned_by":"anthropic",
		"input_modalities":["text","image","file"],
		"output_modalities":["text"],
		"capabilities":{"reasoning":true},
		"context_length":200000,
		"pricings":{"prompt":[{"value":3,"unit":"perMTokens","currency":"USD","conditions":{"prompt_tokens":{"unit":"kTokens","gte":0,"lt":200}}}]}
	}]}`)
	models, ok := parseDiscoveredModels(body, "custom")
	if !ok || len(models) != 1 {
		t.Fatalf("models = %#v, ok = %v", models, ok)
	}
	model := models[0]
	if model.OwnedBy != "anthropic" || model.ContextLimit != 200000 {
		t.Fatalf("metadata not preserved: %#v", model)
	}
	if !reflect.DeepEqual(model.InputModalities, []string{"text", "image", "file"}) {
		t.Fatalf("input modalities = %#v", model.InputModalities)
	}
	if len(model.Pricing["prompt"]) != 1 || model.Pricing["prompt"][0].Value != 3 {
		t.Fatalf("pricing = %#v", model.Pricing)
	}
	condition := model.Pricing["prompt"][0].Conditions["prompt_tokens"]
	if condition.GTE == nil || *condition.GTE != 0 || condition.LT == nil || *condition.LT != 200 {
		t.Fatalf("pricing condition = %#v", condition)
	}
}

func TestParseDiscoveredModelsSupportsNestedCatalogInfo(t *testing.T) {
	body := []byte(`[{
		"id":"o3-mini",
		"info":{"name":"o3 mini","developer":"Open AI","description":"Reasoning model","contextLength":200000,"maxTokens":100000,"url":"https://example.com/o3-mini","docs_url":"https://docs.example.com/o3-mini"},
		"features":["openai/chat-completion.reasoning"],
		"endpoints":["/v1/chat/completions","/v1/responses"]
	}]`)
	models, ok := parseDiscoveredModels(body, "custom")
	if !ok || len(models) != 1 {
		t.Fatalf("models = %#v, ok = %v", models, ok)
	}
	model := models[0]
	if model.Name != "o3 mini" || model.OwnedBy != "Open AI" || model.MaxOutputTokens != 100000 {
		t.Fatalf("nested metadata not preserved: %#v", model)
	}
	if !reflect.DeepEqual(model.APIEndpoints, []string{"/v1/chat/completions", "/v1/responses"}) {
		t.Fatalf("API endpoints = %#v", model.APIEndpoints)
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

func TestDiscoverModelsReportsUnsupportedEndpointWithoutChangingProfiles(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":"remote body must stay private"}`))
	}))
	defer server.Close()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ginContext, _ := gin.CreateTestContext(recorder)
	requestBody := `{"protocol":"openai","endpoints":[{"id":"primary","base_url":"` + server.URL + `/v1","enabled":true}]}`
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/providers/custom/models/discover",
		bytes.NewBufferString(requestBody),
	)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Provider-Key", "temporary-key")
	ginContext.Request = request
	ginContext.Params = gin.Params{{Key: "provider", Value: "custom"}}

	(&ProviderHandler{client: server.Client()}).DiscoverModels(ginContext)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		DiscoverySupported bool `json:"discovery_supported"`
		SuccessCount       int  `json:"success_count"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.DiscoverySupported || response.SuccessCount != 0 {
		t.Fatalf("response = %#v", response)
	}
	if strings.Contains(recorder.Body.String(), "temporary-key") || strings.Contains(recorder.Body.String(), server.URL) {
		t.Fatalf("discovery response leaked request data: %s", recorder.Body.String())
	}
}
