package handler

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	// Internal packages use EncoreHub's stable reverse-domain namespace.
	"com.0d000721.encorehub/gateway/internal/provider"
	"com.0d000721.encorehub/gateway/internal/provider/openaicompat"
	"github.com/gin-gonic/gin"
)

func TestCreateEmbeddings_AppliesConfiguredDimensions(t *testing.T) {
	gin.SetMode(gin.TestMode)
	received := make(chan provider.EmbeddingRequest, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/embeddings" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		var request provider.EmbeddingRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		received <- request
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"object":"list","data":[{"object":"embedding","index":0,"embedding":[0.5]}],"model":"embed-test","usage":{"prompt_tokens":1,"total_tokens":1}}`)
	}))
	t.Cleanup(upstream.Close)

	profile := provider.ProviderProfile{
		ID: "openai-test", Name: "OpenAI Test", Protocol: provider.ProtocolOpenAI,
		BaseURL: upstream.URL + "/v1", Models: []string{"embed-test"}, Enabled: true,
		ModelConfigs: []provider.ProviderModelConfig{{
			ID: "embed-test", Type: provider.ModelTypeEmbedding, Dimensions: 256,
		}},
	}
	registry := provider.NewRegistry(openaicompat.New(profile))
	store := &ProfileStore{registry: registry, profiles: []provider.ProviderProfile{profile}}
	handler := NewProviderHandler(registry, store)
	router := gin.New()
	router.POST("/providers/:provider/embeddings", handler.CreateEmbeddings)

	req := httptest.NewRequest(
		http.MethodPost,
		"/providers/openai-test/embeddings",
		strings.NewReader(`{"model":"embed-test","input":"hello"}`),
	)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Provider-Key", "secret")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if request := <-received; request.Dimensions != 256 || len(request.Input) != 1 || request.Input[0] != "hello" {
		t.Fatalf("upstream request = %#v", request)
	}
}

func TestCreateEmbeddings_RejectsChatModel(t *testing.T) {
	profile := provider.ProviderProfile{
		ID: "openai-test", Name: "OpenAI Test", Protocol: provider.ProtocolOpenAI,
		BaseURL: "https://api.example.com/v1", Models: []string{"gpt-test"}, Enabled: true,
	}
	registry := provider.NewRegistry(openaicompat.New(profile))
	handler := NewProviderHandler(registry, &ProfileStore{profiles: []provider.ProviderProfile{profile}})
	router := gin.New()
	router.POST("/providers/:provider/embeddings", handler.CreateEmbeddings)
	req := httptest.NewRequest(
		http.MethodPost,
		"/providers/openai-test/embeddings",
		strings.NewReader(`{"model":"gpt-test","input":"hello"}`),
	)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Provider-Key", "secret")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
}
