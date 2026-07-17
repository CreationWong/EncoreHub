package router_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/encorehub/gateway/internal/engine"
	"github.com/encorehub/gateway/internal/handler"
	"github.com/encorehub/gateway/internal/provider"
	"github.com/encorehub/gateway/internal/router"
	"github.com/gin-gonic/gin"
)

func init() {
	gin.SetMode(gin.TestMode)
}

func newRouter() *gin.Engine {
	registry := provider.NewRegistry()
	// Engine baseURL is unused in the routes we hit (health/providers). The
	// store is left unloaded, so /providers returns an empty list — fine for
	// the routing/auth/CORS assertions here.
	eng := engine.NewClient("http://127.0.0.1:0", "test-engine-token")
	return router.Setup(router.Config{
		Registry:     registry,
		Engine:       eng,
		ProfileStore: handler.NewProfileStore(eng, registry),
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

func doFrom(t *testing.T, r *gin.Engine, path, remoteAddr, forwardedFor string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.RemoteAddr = remoteAddr
	if forwardedFor != "" {
		req.Header.Set("X-Forwarded-For", forwardedFor)
	}
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}

func TestHealthIsUnauthenticated(t *testing.T) {
	t.Setenv("ENCOREHUB_AUTH_TOKEN", "secret-xyz")
	r := newRouter()

	rec := do(t, r, http.MethodGet, "/api/v1/health/live", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("health status = %d, body=%s", rec.Code, rec.Body.String())
	}
}

func TestHealthReportsEngineUnreachable(t *testing.T) {
	// newRouter() points the engine client at 127.0.0.1:0, which always
	// refuses TCP — readiness must return 503 and flag engine.ok=false.
	r := newRouter()
	rec := do(t, r, http.MethodGet, "/api/v1/health/ready", nil)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("health status = %d", rec.Code)
	}
	body := rec.Body.String()
	for _, want := range []string{
		`"engine":`,
		`"ok":false`,
		`"latency_ms":`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("body missing %q\nbody=%s", want, body)
		}
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

func TestGatewayAuthSettingDoesNotChangeInternalEngineCredential(t *testing.T) {
	for _, tc := range []struct {
		name          string
		gatewayToken  string
		requestHeader string
	}{
		{name: "gateway auth disabled"},
		{
			name:          "gateway auth enabled",
			gatewayToken:  "external-gateway-token",
			requestHeader: "Bearer external-gateway-token",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("ENCOREHUB_AUTH_TOKEN", tc.gatewayToken)

			received := make(chan string, 1)
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				received <- r.Header.Get("Authorization")
				w.Header().Set("Content-Type", "application/json")
				_, _ = io.WriteString(w, `{"skills":[]}`)
			}))
			t.Cleanup(upstream.Close)

			registry := provider.NewRegistry()
			eng := engine.NewClient(upstream.URL, "internal-engine-token")
			r := router.Setup(router.Config{
				Registry:     registry,
				Engine:       eng,
				ProfileStore: handler.NewProfileStore(eng, registry),
			})

			headers := map[string]string{}
			if tc.requestHeader != "" {
				headers["Authorization"] = tc.requestHeader
			}
			rec := do(t, r, http.MethodGet, "/api/v1/skills", headers)
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
			}
			if got := <-received; got != "Bearer internal-engine-token" {
				t.Fatalf("Engine authorization = %q", got)
			}
		})
	}
}

func TestCorsAllowedOriginEchoes(t *testing.T) {
	r := newRouter()
	rec := do(t, r, http.MethodGet, "/api/v1/health/live", map[string]string{
		"Origin": "http://localhost:1420",
	})
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:1420" {
		t.Fatalf("CORS origin echo = %q", got)
	}
}

func TestCorsUnknownOriginNotEchoed(t *testing.T) {
	r := newRouter()
	rec := do(t, r, http.MethodGet, "/api/v1/health/live", map[string]string{
		"Origin": "https://evil.example.com",
	})
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("CORS should not echo unknown origin, got %q", got)
	}
}

func TestMetricsEndpointPublic(t *testing.T) {
	t.Setenv("ENCOREHUB_AUTH_TOKEN", "secret-xyz")
	r := newRouter()

	// Trigger one health request so a counter sample exists.
	_ = do(t, r, http.MethodGet, "/api/v1/health/live", nil)

	rec := do(t, r, http.MethodGet, "/metrics", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("metrics status = %d, body=%s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	for _, want := range []string{
		"encorehub_gateway_requests_total",
		"encorehub_gateway_request_duration_seconds",
		"encorehub_gateway_in_flight_requests",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("metrics body missing %q\nbody=%s", want, body)
		}
	}
}

func TestRequestIDGeneratedWhenAbsent(t *testing.T) {
	r := newRouter()
	rec := do(t, r, http.MethodGet, "/api/v1/health/live", nil)
	got := rec.Header().Get("X-Request-ID")
	if len(got) != 32 { // 16 random bytes hex-encoded
		t.Fatalf("expected 32-char hex id, got %q (len=%d)", got, len(got))
	}
}

func TestRequestIDEchoedWhenSupplied(t *testing.T) {
	r := newRouter()
	rec := do(t, r, http.MethodGet, "/api/v1/health/live", map[string]string{
		"X-Request-ID": "my-trace-42",
	})
	if got := rec.Header().Get("X-Request-ID"); got != "my-trace-42" {
		t.Fatalf("inbound id should be echoed; got %q", got)
	}
}

func TestDirectModeIgnoresForwardedClientIP(t *testing.T) {
	t.Setenv("ENCOREHUB_TRUSTED_PROXIES", "")
	t.Setenv("ENCOREHUB_RATE_LIMIT_RPS", "0.01")
	t.Setenv("ENCOREHUB_RATE_LIMIT_BURST", "1")
	r := newRouter()

	first := doFrom(t, r, "/metrics", "198.51.100.10:1234", "203.0.113.1")
	second := doFrom(t, r, "/metrics", "198.51.100.10:1234", "203.0.113.2")
	if first.Code != http.StatusOK {
		t.Fatalf("first status = %d", first.Code)
	}
	if second.Code != http.StatusTooManyRequests {
		t.Fatalf("forged forwarded IP bypassed limiter: status = %d", second.Code)
	}
}

func TestExplicitTrustedProxyUsesForwardedClientIP(t *testing.T) {
	t.Setenv("ENCOREHUB_TRUSTED_PROXIES", "198.51.100.0/24")
	t.Setenv("ENCOREHUB_RATE_LIMIT_RPS", "0.01")
	t.Setenv("ENCOREHUB_RATE_LIMIT_BURST", "1")
	r := newRouter()

	first := doFrom(t, r, "/metrics", "198.51.100.10:1234", "203.0.113.1")
	second := doFrom(t, r, "/metrics", "198.51.100.10:1234", "203.0.113.2")
	if first.Code != http.StatusOK || second.Code != http.StatusOK {
		t.Fatalf("trusted proxy client separation failed: first=%d second=%d", first.Code, second.Code)
	}
}
