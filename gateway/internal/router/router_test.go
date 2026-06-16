package router_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/encorehub/gateway/internal/engine"
	"github.com/encorehub/gateway/internal/provider"
	"github.com/encorehub/gateway/internal/provider/openai"
	"github.com/encorehub/gateway/internal/router"
	"github.com/gin-gonic/gin"
)

func init() {
	gin.SetMode(gin.TestMode)
}

func newRouter() *gin.Engine {
	registry := provider.NewRegistry(openai.New())
	// Engine baseURL is unused in the routes we hit (health/providers).
	return router.Setup(router.Config{
		Registry: registry,
		Engine:   engine.NewClient("http://127.0.0.1:0"),
	})
}

func do(t *testing.T, r *gin.Engine, method, path string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, nil)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}

func TestHealthIsUnauthenticated(t *testing.T) {
	t.Setenv("ENCOREHUB_AUTH_TOKEN", "secret-xyz")
	r := newRouter()

	rec := do(t, r, http.MethodGet, "/api/v1/health", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("health status = %d, body=%s", rec.Code, rec.Body.String())
	}
}

func TestProvidersOpenWhenNoToken(t *testing.T) {
	t.Setenv("ENCOREHUB_AUTH_TOKEN", "")
	r := newRouter()

	rec := do(t, r, http.MethodGet, "/api/v1/providers", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("providers status = %d, body=%s", rec.Code, rec.Body.String())
	}
}

func TestProvidersRejectsMissingToken(t *testing.T) {
	t.Setenv("ENCOREHUB_AUTH_TOKEN", "secret-xyz")
	r := newRouter()

	rec := do(t, r, http.MethodGet, "/api/v1/providers", nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestProvidersAcceptsBearer(t *testing.T) {
	t.Setenv("ENCOREHUB_AUTH_TOKEN", "secret-xyz")
	r := newRouter()

	rec := do(t, r, http.MethodGet, "/api/v1/providers", map[string]string{
		"Authorization": "Bearer secret-xyz",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestProvidersRejectsWrongBearer(t *testing.T) {
	t.Setenv("ENCOREHUB_AUTH_TOKEN", "secret-xyz")
	r := newRouter()

	rec := do(t, r, http.MethodGet, "/api/v1/providers", map[string]string{
		"Authorization": "Bearer nope",
	})
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestCorsAllowedOriginEchoes(t *testing.T) {
	r := newRouter()
	rec := do(t, r, http.MethodGet, "/api/v1/health", map[string]string{
		"Origin": "http://localhost:1420",
	})
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:1420" {
		t.Fatalf("CORS origin echo = %q", got)
	}
}

func TestCorsUnknownOriginNotEchoed(t *testing.T) {
	r := newRouter()
	rec := do(t, r, http.MethodGet, "/api/v1/health", map[string]string{
		"Origin": "https://evil.example.com",
	})
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("CORS should not echo unknown origin, got %q", got)
	}
}
