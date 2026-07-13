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

func init() {
	gin.SetMode(gin.TestMode)
}

// fakeEngine returns a httptest server that records the last request it
// received so a test can assert proxy translation.
type fakeEngine struct {
	*httptest.Server
	last *http.Request
	body string
}

func newFakeEngine(t *testing.T, status int, replyBody string) *fakeEngine {
	t.Helper()
	fe := &fakeEngine{}
	fe.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Capture by value: r.Body is read once.
		buf, _ := io.ReadAll(r.Body)
		clone := r.Clone(r.Context())
		clone.Body = http.NoBody
		fe.last = clone
		fe.body = string(buf)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, replyBody)
	}))
	t.Cleanup(fe.Close)
	return fe
}

const testEngineToken = "test-engine-token"

func newProxyRouter(target string) *gin.Engine {
	r := gin.New()
	proxy := handler.NewEngineProxy(engine.NewClient(target, testEngineToken))
	for _, res := range []string{"skills", "memories", "knowledge"} {
		r.Any("/api/v1/"+res, proxy.Forward)
		r.Any("/api/v1/"+res+"/*rest", proxy.Forward)
	}
	return r
}

func do(t *testing.T, r *gin.Engine, method, path string, body string) *httptest.ResponseRecorder {
	t.Helper()
	var br io.Reader
	if body != "" {
		br = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, br)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}

func TestForward_TranslatesPrefixAndProxiesBody(t *testing.T) {
	fe := newFakeEngine(t, http.StatusOK, `{"skills":[]}`)
	r := newProxyRouter(fe.URL)

	rec := do(t, r, http.MethodGet, "/api/v1/skills", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if fe.last == nil {
		t.Fatal("engine did not receive request")
	}
	if fe.last.URL.Path != "/api/skills" {
		t.Errorf("path = %q, want /api/skills", fe.last.URL.Path)
	}
	if got := fe.last.Header.Get("Authorization"); got != "Bearer "+testEngineToken {
		t.Errorf("internal authorization = %q", got)
	}
	if !strings.Contains(rec.Body.String(), `"skills"`) {
		t.Errorf("response body not piped through: %q", rec.Body.String())
	}
}

func TestForward_PreservesQueryString(t *testing.T) {
	fe := newFakeEngine(t, http.StatusOK, `{"results":[]}`)
	r := newProxyRouter(fe.URL)

	_ = do(t, r, http.MethodGet, "/api/v1/memories/search?q=hello&top_k=5", "")
	if fe.last == nil {
		t.Fatal("engine did not receive request")
	}
	if fe.last.URL.Query().Get("q") != "hello" {
		t.Errorf("q lost: %q", fe.last.URL.RawQuery)
	}
	if fe.last.URL.Query().Get("top_k") != "5" {
		t.Errorf("top_k lost: %q", fe.last.URL.RawQuery)
	}
}

func TestForward_PassesThroughPostBody(t *testing.T) {
	fe := newFakeEngine(t, http.StatusCreated, `{"id":"k1"}`)
	r := newProxyRouter(fe.URL)

	body := `{"title":"doc","content":"hello"}`
	rec := do(t, r, http.MethodPost, "/api/v1/knowledge", body)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d", rec.Code)
	}
	if fe.body != body {
		t.Errorf("body not forwarded verbatim: %q", fe.body)
	}
	if fe.last.Method != http.MethodPost {
		t.Errorf("method = %q", fe.last.Method)
	}
	if fe.last.Header.Get("Content-Type") != "application/json" {
		t.Errorf("content-type lost: %q", fe.last.Header.Get("Content-Type"))
	}
}

func TestForward_502WhenEngineUnreachable(t *testing.T) {
	// Engine server we never start; pick a port we know nothing listens on.
	r := newProxyRouter("http://127.0.0.1:1")
	rec := do(t, r, http.MethodGet, "/api/v1/skills", "")
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected 502 when engine unreachable, got %d", rec.Code)
	}
}

func TestForward_PreservesUpstreamStatusCode(t *testing.T) {
	fe := newFakeEngine(t, http.StatusNotFound, `{"error":"missing"}`)
	r := newProxyRouter(fe.URL)
	rec := do(t, r, http.MethodGet, "/api/v1/skills/does-not-exist", "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 echo, got %d", rec.Code)
	}
}
