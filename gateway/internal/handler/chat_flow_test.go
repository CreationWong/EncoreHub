package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/encorehub/gateway/internal/engine"
	"github.com/encorehub/gateway/internal/provider"
	"github.com/gin-gonic/gin"
)

type scriptedAdapter struct {
	chatCalls   atomic.Int32
	streamCalls atomic.Int32
	chatFn      func(context.Context, *provider.ChatRequest) (*provider.ChatResponse, error)
	streamFn    func(context.Context, *provider.ChatRequest, int) (<-chan provider.StreamEvent, error)
}

func (a *scriptedAdapter) ID() string { return "test" }

func (a *scriptedAdapter) Chat(ctx context.Context, req *provider.ChatRequest, _ string) (*provider.ChatResponse, error) {
	a.chatCalls.Add(1)
	if a.chatFn == nil {
		return nil, errors.New("unexpected Chat call")
	}
	return a.chatFn(ctx, req)
}

func (a *scriptedAdapter) ChatStream(ctx context.Context, req *provider.ChatRequest, _ string) (<-chan provider.StreamEvent, error) {
	call := int(a.streamCalls.Add(1))
	if a.streamFn == nil {
		return nil, errors.New("unexpected ChatStream call")
	}
	return a.streamFn(ctx, req, call)
}

func (a *scriptedAdapter) ListModels(context.Context, string) ([]provider.ModelInfo, error) {
	return nil, nil
}

func (a *scriptedAdapter) ValidateKey(context.Context, string) error { return nil }

type chatEngineStub struct {
	mu                   sync.Mutex
	beginStatus          int
	finalizeStatus       int
	beginRequests        int
	finalizeRequests     []engine.FinalizeTurnRequest
	conversationMessages []engine.Message
}

func (s *chatEngineStub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/api/conversations/c1":
		writeTestJSON(w, http.StatusOK, engine.ConversationDetail{
			ID:       "c1",
			Title:    "Existing",
			Provider: "test",
			Model:    "model-test",
			Messages: s.conversationMessages,
		})
	case r.Method == http.MethodGet && (r.URL.Path == "/api/memories/search" || r.URL.Path == "/api/knowledge/search"):
		writeTestJSON(w, http.StatusOK, map[string]any{"results": []any{}})
	case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/api/secrets/"):
		w.WriteHeader(http.StatusNotFound)
	case r.Method == http.MethodPost && r.URL.Path == "/api/conversations/c1/turns":
		s.mu.Lock()
		s.beginRequests++
		status := s.beginStatus
		s.mu.Unlock()
		if status >= http.StatusBadRequest {
			http.Error(w, "begin failed", status)
			return
		}
		var request struct {
			Content string `json:"content"`
		}
		_ = json.NewDecoder(r.Body).Decode(&request)
		writeTestJSON(w, http.StatusOK, engine.Message{
			ID:        "turn-1",
			Role:      "user",
			Content:   request.Content,
			Status:    "pending",
			CreatedAt: "2026-07-16T00:00:00Z",
		})
	case r.Method == http.MethodPost && r.URL.Path == "/api/conversations/c1/turns/turn-1/finalize":
		var request engine.FinalizeTurnRequest
		_ = json.NewDecoder(r.Body).Decode(&request)
		s.mu.Lock()
		s.finalizeRequests = append(s.finalizeRequests, request)
		status := s.finalizeStatus
		s.mu.Unlock()
		if status >= http.StatusBadRequest {
			http.Error(w, "finalize failed", status)
			return
		}
		user := engine.Message{
			ID:        "turn-1",
			Role:      "user",
			Content:   "hello",
			Status:    request.Status,
			CreatedAt: "2026-07-16T00:00:00Z",
		}
		var assistant *engine.Message
		if request.Assistant != nil {
			parentID := user.ID
			assistant = &engine.Message{
				ID:         "assistant-authoritative",
				Role:       "assistant",
				Content:    request.Assistant.Content,
				Reasoning:  request.Assistant.Reasoning,
				ParentID:   &parentID,
				ToolCalls:  request.Assistant.ToolCalls,
				TokenCount: request.Assistant.TokenCount,
				Status:     request.Status,
				CreatedAt:  "2026-07-16T00:00:01Z",
			}
		}
		writeTestJSON(w, http.StatusOK, engine.FinalizeTurnResponse{
			UserMessage:      user,
			AssistantMessage: assistant,
		})
	case r.Method == http.MethodPatch && r.URL.Path == "/api/conversations/c1":
		writeTestJSON(w, http.StatusOK, engine.Conversation{ID: "c1", Title: "Renamed"})
	default:
		http.Error(w, "unexpected engine request: "+r.Method+" "+r.URL.String(), http.StatusNotFound)
	}
}

func (s *chatEngineStub) finalizations() []engine.FinalizeTurnRequest {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]engine.FinalizeTurnRequest(nil), s.finalizeRequests...)
}

func writeTestJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func streamOf(events ...provider.StreamEvent) <-chan provider.StreamEvent {
	stream := make(chan provider.StreamEvent, len(events))
	for _, event := range events {
		stream <- event
	}
	close(stream)
	return stream
}

func newChatTestRouter(adapter provider.Adapter, stub *chatEngineStub) (*gin.Engine, *httptest.Server) {
	engineServer := httptest.NewServer(stub)
	handler := NewChatHandler(provider.NewRegistry(adapter), engine.NewClient(engineServer.URL, "test-token"))
	router := gin.New()
	router.POST("/api/v1/conversations/:id/chat", handler.SendMessage)
	return router, engineServer
}

func performStreamRequest(t *testing.T, router http.Handler, ctx context.Context) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/conversations/c1/chat",
		bytes.NewBufferString(`{"content":"hello","provider":"test","model":"model-test","stream":true}`),
	).WithContext(ctx)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Provider-Key", "provider-key")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	return recorder
}

func TestSendMessage_MissingKeyDoesNotCreateTurn(t *testing.T) {
	t.Setenv("ENCOREHUB_DEV_MOCK", "")
	gin.SetMode(gin.TestMode)

	var writeRequests atomic.Int32
	engineServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/secrets/openai":
			w.WriteHeader(http.StatusNotFound)
		case r.Method == http.MethodGet && r.URL.Path == "/api/conversations/c1":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"c1","provider":"openai","model":"gpt-test","messages":[]}`))
		case r.Method == http.MethodGet && r.URL.Path == "/api/memories/search":
			_, _ = w.Write([]byte(`{"results":[]}`))
		case r.Method == http.MethodGet && r.URL.Path == "/api/knowledge/search":
			_, _ = w.Write([]byte(`{"results":[]}`))
		case r.Method == http.MethodPost:
			writeRequests.Add(1)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"unexpected-message"}`))
		default:
			t.Fatalf("unexpected engine request: %s %s", r.Method, r.URL.String())
		}
	}))
	defer engineServer.Close()

	handler := NewChatHandler(provider.NewRegistry(), engine.NewClient(engineServer.URL, "test-token"))
	router := gin.New()
	router.POST("/api/v1/conversations/:id/chat", handler.SendMessage)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/conversations/c1/chat",
		bytes.NewBufferString(`{"content":"hello","provider":"openai","model":"gpt-test"}`),
	)
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if got := writeRequests.Load(); got != 0 {
		t.Fatalf("engine write requests = %d, want 0", got)
	}
}

func TestSendMessage_BeginFailurePreventsProviderCall(t *testing.T) {
	gin.SetMode(gin.TestMode)
	stub := &chatEngineStub{beginStatus: http.StatusInternalServerError}
	adapter := &scriptedAdapter{}
	router, engineServer := newChatTestRouter(adapter, stub)
	defer engineServer.Close()

	recorder := performStreamRequest(t, router, context.Background())

	if recorder.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if got := adapter.streamCalls.Load(); got != 0 {
		t.Fatalf("provider stream calls = %d, want 0", got)
	}
	if got := len(stub.finalizations()); got != 0 {
		t.Fatalf("finalize requests = %d, want 0", got)
	}
}

func TestSendMessage_DoneCarriesCommittedMessages(t *testing.T) {
	gin.SetMode(gin.TestMode)
	stub := &chatEngineStub{}
	adapter := &scriptedAdapter{
		streamFn: func(context.Context, *provider.ChatRequest, int) (<-chan provider.StreamEvent, error) {
			return streamOf(
				provider.StreamEvent{Delta: &provider.DeltaEvent{Content: "answer"}},
				provider.StreamEvent{Usage: &provider.UsageEvent{InputTokens: 2, OutputTokens: 3}},
			), nil
		},
	}
	router, engineServer := newChatTestRouter(adapter, stub)
	defer engineServer.Close()

	recorder := performStreamRequest(t, router, context.Background())
	body := recorder.Body.String()
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, body)
	}
	if strings.Index(body, "event: turn_started") > strings.Index(body, "event: delta") {
		t.Fatalf("turn_started was not the first chat frame: %s", body)
	}

	var done chatDonePayload
	decodeSSEEvent(t, body, "done", &done)
	if done.UserMessage.ID != "turn-1" || done.UserMessage.Status != "completed" {
		t.Fatalf("unexpected authoritative user: %+v", done.UserMessage)
	}
	if done.AssistantMessage == nil || done.AssistantMessage.ID != "assistant-authoritative" {
		t.Fatalf("unexpected authoritative assistant: %+v", done.AssistantMessage)
	}
	if done.Usage.InputTokens != 2 || done.Usage.OutputTokens != 3 {
		t.Fatalf("unexpected done usage: %+v", done.Usage)
	}

	requests := stub.finalizations()
	if len(requests) != 1 || requests[0].Status != "completed" {
		t.Fatalf("finalize requests = %+v", requests)
	}
	if requests[0].Assistant == nil || requests[0].Assistant.TokenCount != 5 {
		t.Fatalf("unexpected finalized assistant: %+v", requests[0].Assistant)
	}
}

func TestSendMessage_NonStreamingReturnsCommittedMessages(t *testing.T) {
	gin.SetMode(gin.TestMode)
	stub := &chatEngineStub{}
	adapter := &scriptedAdapter{
		chatFn: func(_ context.Context, req *provider.ChatRequest) (*provider.ChatResponse, error) {
			if len(req.Messages) != 1 || req.Messages[0].Content != "hello" {
				t.Fatalf("current user message missing from provider request: %+v", req.Messages)
			}
			return &provider.ChatResponse{
				Content:          "answer",
				ReasoningContent: "reasoning",
				InputTokens:      4,
				OutputTokens:     6,
			}, nil
		},
	}
	router, engineServer := newChatTestRouter(adapter, stub)
	defer engineServer.Close()

	request := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/conversations/c1/chat",
		bytes.NewBufferString(`{"content":"hello","provider":"test","model":"model-test"}`),
	)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Provider-Key", "provider-key")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var response ChatResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.UserMessage.ID != "turn-1" || response.AssistantMessage == nil || response.AssistantMessage.ID != "assistant-authoritative" {
		t.Fatalf("response did not use committed messages: %+v", response)
	}
	requests := stub.finalizations()
	if len(requests) != 1 || requests[0].Assistant == nil || requests[0].Assistant.TokenCount != 10 || requests[0].Assistant.Reasoning != "reasoning" {
		t.Fatalf("unexpected finalization: %+v", requests)
	}
}

func TestSendMessage_FinalizeFailureEmitsStructuredErrorWithoutDone(t *testing.T) {
	gin.SetMode(gin.TestMode)
	stub := &chatEngineStub{finalizeStatus: http.StatusInternalServerError}
	adapter := &scriptedAdapter{
		streamFn: func(context.Context, *provider.ChatRequest, int) (<-chan provider.StreamEvent, error) {
			return streamOf(provider.StreamEvent{Delta: &provider.DeltaEvent{Content: "answer"}}), nil
		},
	}
	router, engineServer := newChatTestRouter(adapter, stub)
	defer engineServer.Close()

	recorder := performStreamRequest(t, router, context.Background())
	body := recorder.Body.String()
	if strings.Contains(body, "event: done") {
		t.Fatalf("done emitted after failed finalization: %s", body)
	}
	var payload chatErrorPayload
	decodeSSEEvent(t, body, "error", &payload)
	if payload.Code != "persistence_error" || payload.Message == "" {
		t.Fatalf("unexpected error payload: %+v", payload)
	}
	requests := stub.finalizations()
	if len(requests) != 2 || requests[0].Status != "completed" || requests[1].Status != "failed" {
		t.Fatalf("expected completed attempt plus failed fallback, got %+v", requests)
	}
}

func TestSendMessage_ProviderFailurePersistsPartialFailedTurn(t *testing.T) {
	gin.SetMode(gin.TestMode)
	stub := &chatEngineStub{}
	adapter := &scriptedAdapter{
		streamFn: func(context.Context, *provider.ChatRequest, int) (<-chan provider.StreamEvent, error) {
			return streamOf(
				provider.StreamEvent{Delta: &provider.DeltaEvent{Content: "partial"}},
				provider.StreamEvent{Error: errors.New("remote failure\n\nevent: done\ndata: {}")},
			), nil
		},
	}
	router, engineServer := newChatTestRouter(adapter, stub)
	defer engineServer.Close()

	recorder := performStreamRequest(t, router, context.Background())
	body := recorder.Body.String()
	if strings.Contains(body, "remote failure") || strings.Contains(body, "event: done") {
		t.Fatalf("unsafe provider error escaped into SSE: %s", body)
	}
	var payload chatErrorPayload
	decodeSSEEvent(t, body, "error", &payload)
	if payload.Code != "provider_error" || payload.UserMessage == nil || payload.UserMessage.Status != "failed" {
		t.Fatalf("unexpected provider error payload: %+v", payload)
	}
	if payload.AssistantMessage == nil || payload.AssistantMessage.Content != "partial" || payload.AssistantMessage.Status != "failed" {
		t.Fatalf("unexpected failed partial assistant: %+v", payload.AssistantMessage)
	}
	requests := stub.finalizations()
	if len(requests) != 1 || requests[0].Status != "failed" || requests[0].Assistant == nil || requests[0].Assistant.Content != "partial" {
		t.Fatalf("unexpected failed finalization: %+v", requests)
	}
}

func TestSendMessage_StopPersistsPartialStoppedTurn(t *testing.T) {
	gin.SetMode(gin.TestMode)
	stub := &chatEngineStub{}
	deltaSent := make(chan struct{})
	adapter := &scriptedAdapter{
		streamFn: func(ctx context.Context, _ *provider.ChatRequest, _ int) (<-chan provider.StreamEvent, error) {
			stream := make(chan provider.StreamEvent)
			go func() {
				stream <- provider.StreamEvent{Delta: &provider.DeltaEvent{Content: "partial"}}
				close(deltaSent)
				<-ctx.Done()
				close(stream)
			}()
			return stream, nil
		},
	}
	router, engineServer := newChatTestRouter(adapter, stub)
	defer engineServer.Close()

	requestCtx, cancel := context.WithCancel(context.Background())
	result := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		result <- performStreamRequest(t, router, requestCtx)
	}()
	select {
	case <-deltaSent:
		cancel()
	case <-time.After(2 * time.Second):
		t.Fatal("provider did not emit the partial delta")
	}
	select {
	case <-result:
	case <-time.After(2 * time.Second):
		t.Fatal("cancelled stream did not finish")
	}

	requests := stub.finalizations()
	if len(requests) != 1 || requests[0].Status != "stopped" {
		t.Fatalf("unexpected stop finalization: %+v", requests)
	}
	if requests[0].Assistant == nil || requests[0].Assistant.Content != "partial" {
		t.Fatalf("partial assistant was not persisted on Stop: %+v", requests[0].Assistant)
	}
}

func TestSendMessage_ToolRoundsAccumulateContentAndUsage(t *testing.T) {
	gin.SetMode(gin.TestMode)
	stub := &chatEngineStub{
		conversationMessages: []engine.Message{
			{ID: "m1", Role: "user", Content: "one", Status: "completed"},
			{ID: "m2", Role: "assistant", Content: "two", Status: "completed"},
			{ID: "m3", Role: "user", Content: "three", Status: "completed"},
		},
	}
	adapter := &scriptedAdapter{
		streamFn: func(_ context.Context, req *provider.ChatRequest, call int) (<-chan provider.StreamEvent, error) {
			switch call {
			case 1:
				if len(req.Messages) != 4 || req.Messages[3].Content != "hello" {
					t.Fatalf("current user message missing from provider request: %+v", req.Messages)
				}
				return streamOf(
					provider.StreamEvent{Delta: &provider.DeltaEvent{Content: "preface"}},
					provider.StreamEvent{ToolCall: &provider.ToolCallEvent{
						Index: 0, ID: "title-call", Name: "update_conversation_title", Arguments: `{"title":"Renamed"}`,
					}},
					provider.StreamEvent{Usage: &provider.UsageEvent{InputTokens: 3, OutputTokens: 4}},
				), nil
			case 2:
				return streamOf(
					provider.StreamEvent{Delta: &provider.DeltaEvent{Content: "answer"}},
					provider.StreamEvent{Usage: &provider.UsageEvent{InputTokens: 5, OutputTokens: 6}},
				), nil
			default:
				return nil, errors.New("unexpected extra tool round")
			}
		},
	}
	router, engineServer := newChatTestRouter(adapter, stub)
	defer engineServer.Close()

	recorder := performStreamRequest(t, router, context.Background())
	body := recorder.Body.String()
	if got := strings.Count(body, "event: usage"); got != 2 {
		t.Fatalf("usage event count = %d, body = %s", got, body)
	}
	var done chatDonePayload
	decodeSSEEvent(t, body, "done", &done)
	if done.Usage.InputTokens != 8 || done.Usage.OutputTokens != 10 {
		t.Fatalf("unexpected accumulated usage: %+v", done.Usage)
	}
	if done.AssistantMessage == nil || done.AssistantMessage.Content != "prefaceanswer" || done.AssistantMessage.TokenCount != 18 {
		t.Fatalf("unexpected accumulated assistant: %+v", done.AssistantMessage)
	}
	requests := stub.finalizations()
	if len(requests) != 1 || requests[0].Assistant == nil {
		t.Fatalf("unexpected finalization: %+v", requests)
	}
	if len(requests[0].Assistant.ToolCalls) != 1 || requests[0].Assistant.ToolCalls[0].Status != "success" {
		t.Fatalf("executed tool call was not persisted authoritatively: %+v", requests[0].Assistant.ToolCalls)
	}
}

func decodeSSEEvent(t *testing.T, body, event string, target any) {
	t.Helper()
	prefix := "event: " + event + "\ndata: "
	start := strings.Index(body, prefix)
	if start == -1 {
		t.Fatalf("SSE event %q not found in %s", event, body)
	}
	data := body[start+len(prefix):]
	if end := strings.Index(data, "\n\n"); end >= 0 {
		data = data[:end]
	}
	if err := json.Unmarshal([]byte(data), target); err != nil {
		t.Fatalf("decode SSE event %q: %v; data=%q", event, err, data)
	}
}
