package handler_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/encorehub/gateway/internal/engine"
	"github.com/encorehub/gateway/internal/handler"
	"github.com/gin-gonic/gin"
)

// renameRouter mounts just the Rename handler — keeps tests isolated from
// the rest of router.go (auth, rate-limit, request-id).
func renameRouter(target string) *gin.Engine {
	r := gin.New()
	h := handler.NewConversationHandler(engine.NewClient(target, "test-engine-token"))
	r.PATCH("/api/v1/conversations/:id", h.Rename)
	return r
}

func deleteRouter(target string) *gin.Engine {
	r := gin.New()
	h := handler.NewConversationHandler(engine.NewClient(target, "test-engine-token"))
	r.DELETE("/api/v1/conversations/:id", h.Delete)
	return r
}

func TestDelete_UsesAuthenticatedEngineClient(t *testing.T) {
	gin.SetMode(gin.TestMode)

	var authorization string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authorization = r.Header.Get("Authorization")
		if authorization != "Bearer test-engine-token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	r := deleteRouter(server.URL)
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/conversations/c1", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if authorization != "Bearer test-engine-token" {
		t.Fatalf("engine authorization = %q", authorization)
	}
}

func TestRename_ForwardsPatchBodyAndReturnsEngineJSON(t *testing.T) {
	gin.SetMode(gin.TestMode)

	var got struct {
		method string
		path   string
		body   string
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		buf, _ := io.ReadAll(r.Body)
		got.method = r.Method
		got.path = r.URL.Path
		got.body = string(buf)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, `{"id":"c1","title":"new"}`)
	}))
	defer server.Close()

	r := renameRouter(server.URL)
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/conversations/c1",
		strings.NewReader(`{"title":"new"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if got.method != http.MethodPatch {
		t.Errorf("upstream method = %q", got.method)
	}
	if got.path != "/api/conversations/c1" {
		t.Errorf("upstream path = %q", got.path)
	}
	if !strings.Contains(got.body, `"title":"new"`) {
		t.Errorf("upstream body = %q", got.body)
	}
	if !strings.Contains(rec.Body.String(), `"title":"new"`) {
		t.Errorf("response not piped through: %q", rec.Body.String())
	}
}

func TestUpdate_ForwardsProviderAndModelWithoutCreatingConversation(t *testing.T) {
	gin.SetMode(gin.TestMode)

	var gotBody string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		buf, _ := io.ReadAll(r.Body)
		gotBody = string(buf)
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"id":"c1","provider":"anthropic","model":"claude-sonnet-4"}`)
	}))
	defer server.Close()

	r := renameRouter(server.URL)
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/conversations/c1",
		strings.NewReader(`{"provider":"anthropic","model":"claude-sonnet-4"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(gotBody, `"provider":"anthropic"`) ||
		!strings.Contains(gotBody, `"model":"claude-sonnet-4"`) {
		t.Fatalf("upstream body = %q", gotBody)
	}
	if strings.Contains(gotBody, `"title"`) {
		t.Fatalf("model-only update unexpectedly included title: %q", gotBody)
	}
}

func TestUpdate_400OnIncompleteProviderModelPair(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := renameRouter("http://127.0.0.1:1")

	req := httptest.NewRequest(http.MethodPatch, "/api/v1/conversations/c1",
		strings.NewReader(`{"provider":"anthropic"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 on incomplete provider/model pair, got %d body=%s",
			rec.Code, rec.Body.String())
	}
}

func TestUpdate_400OnEmptyPatch(t *testing.T) {
	gin.SetMode(gin.TestMode)
	// engine should never be called; point it at an unreachable port to be sure
	r := renameRouter("http://127.0.0.1:1")

	req := httptest.NewRequest(http.MethodPatch, "/api/v1/conversations/c1",
		strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 on empty patch, got %d body=%s",
			rec.Code, rec.Body.String())
	}
}

func TestRename_500WhenEngineFails(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = io.WriteString(w, `{"error":"db down"}`)
	}))
	defer server.Close()

	r := renameRouter(server.URL)
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/conversations/c1",
		strings.NewReader(`{"title":"x"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 when engine errors, got %d", rec.Code)
	}
}
