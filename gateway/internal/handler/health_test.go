package handler

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	// Internal packages use EncoreHub's stable reverse-domain namespace.
	"com.0d000721.encorehub/gateway/internal/engine"
	"github.com/gin-gonic/gin"
)

func TestGatewayLivenessDoesNotProbeEngine(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var hits atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		hits.Add(1)
	}))
	t.Cleanup(server.Close)
	handler := NewHealthHandler(engine.NewClient(server.URL, "token"))
	router := gin.New()
	router.GET("/live", handler.Live)

	request := httptest.NewRequest(http.MethodGet, "/live", nil)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d", recorder.Code)
	}
	if hits.Load() != 0 {
		t.Fatalf("liveness probed Engine %d times", hits.Load())
	}
}

func TestGatewayReadinessPropagatesEngineDatabaseState(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, test := range []struct {
		name       string
		databaseOK bool
		wantStatus int
	}{
		{name: "ready", databaseOK: true, wantStatus: http.StatusOK},
		{name: "database unavailable", databaseOK: false, wantStatus: http.StatusServiceUnavailable},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/health/ready" {
					t.Fatalf("path = %q", r.URL.Path)
				}
				if r.Header.Get("Authorization") != "Bearer token" {
					t.Fatalf("missing Engine auth header")
				}
				w.Header().Set("Content-Type", "application/json")
				status := "not_ready"
				if test.databaseOK {
					status = "ok"
				}
				_, _ = io.WriteString(w, `{"status":"`+status+`","database":{"ok":`+boolString(test.databaseOK)+`},"version_info":{"component":"engine","version":"V0.1.0.0","build_id":"260813600474","compatibility":{"gateway":{"min":"V0.1.0.0","max_exclusive":"V0.2.0.0"},"frontend":{"min":"V0.1.0.0","max_exclusive":"V0.2.0.0"}}}}`)
			}))
			t.Cleanup(server.Close)
			handler := NewHealthHandler(engine.NewClient(server.URL, "token"))
			router := gin.New()
			router.GET("/ready", handler.Ready)

			request := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/ready", nil)
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, request)
			if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
			}
		})
	}
}

func boolString(value bool) string {
	if value {
		return "true"
	}
	return "false"
}
