// Package handler tests end-to-end chat orchestration against a stub Engine.
package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	// Internal packages use EncoreHub's stable reverse-domain namespace.
	"com.0d000721.encorehub/gateway/internal/engine"
	"com.0d000721.encorehub/gateway/internal/provider"
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
	mu                    sync.Mutex
	beginStatus           int
	finalizeStatus        int
	beginRequests         int
	beginReplaceMessageID string
	finalizeRequests      []engine.FinalizeTurnRequest
	rememberRequests      []engine.RememberMemoryRequest
	conversationMessages  []engine.Message
	searchConfig          string
	memoryMode            string
	memoryResults         []engine.MemoryHit
	memorySearchQueries   []string
	conversationTitle     string
	networkFetch          func(string) engine.NetworkFetchResponse
}

func (s *chatEngineStub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/api/conversations/c1":
		s.mu.Lock()
		title := s.conversationTitle
		if title == "" {
			title = "Existing"
		}
		messages := append([]engine.Message(nil), s.conversationMessages...)
		s.mu.Unlock()
		writeTestJSON(w, http.StatusOK, engine.ConversationDetail{
			ID:          "c1",
			Title:       title,
			Provider:    "test",
			Model:       "model-test",
			CharacterID: "character-default",
			Messages:    messages,
		})
	case r.Method == http.MethodGet && r.URL.Path == "/api/memories/search":
		s.mu.Lock()
		s.memorySearchQueries = append(s.memorySearchQueries, r.URL.RawQuery)
		results := append([]engine.MemoryHit(nil), s.memoryResults...)
		s.mu.Unlock()
		writeTestJSON(w, http.StatusOK, map[string]any{"results": results})
	case r.Method == http.MethodGet && r.URL.Path == "/api/knowledge/search":
		writeTestJSON(w, http.StatusOK, map[string]any{"results": []any{}})
	case r.Method == http.MethodPost && r.URL.Path == "/api/conversations/c1/memory-mode/resolve":
		mode := s.memoryMode
		if mode == "" {
			mode = "simple"
		}
		writeTestJSON(w, http.StatusOK, engine.ConversationMemoryMode{
			ConversationID: "c1", CharacterID: "character-default", Mode: mode,
		})
	case r.Method == http.MethodGet && r.URL.Path == "/api/config/web_search_settings" && s.searchConfig != "":
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(s.searchConfig))
	case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/api/secrets/"):
		w.WriteHeader(http.StatusNotFound)
	case r.Method == http.MethodPost && r.URL.Path == "/api/network/fetch":
		// Tests can fix provider responses locally or forward to their own server.
		var request struct {
			URL     string            `json:"url"`
			Headers map[string]string `json:"headers"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			http.Error(w, "invalid fetch request", http.StatusBadRequest)
			return
		}
		if s.networkFetch != nil {
			writeTestJSON(w, http.StatusOK, s.networkFetch(request.URL))
			return
		}
		upstreamRequest, err := http.NewRequestWithContext(r.Context(), http.MethodGet, request.URL, nil)
		if err != nil {
			http.Error(w, "invalid upstream URL", http.StatusBadRequest)
			return
		}
		for name, value := range request.Headers {
			upstreamRequest.Header.Set(name, value)
		}
		upstreamResponse, err := http.DefaultClient.Do(upstreamRequest)
		if err != nil {
			http.Error(w, "test upstream failed", http.StatusBadGateway)
			return
		}
		defer upstreamResponse.Body.Close()
		body, _ := io.ReadAll(upstreamResponse.Body)
		response := engine.NetworkFetchResponse{
			Status:      upstreamResponse.StatusCode,
			FinalURL:    request.URL,
			ContentType: upstreamResponse.Header.Get("Content-Type"),
			Body:        string(body),
			Backend:     "curl",
		}
		if strings.HasPrefix(strings.ToLower(response.ContentType), "text/html") {
			response.Title = "Example Article"
			response.ExtractedText = "Page content for the model."
		}
		writeTestJSON(w, http.StatusOK, response)
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
			Content          string `json:"content"`
			ReplaceMessageID string `json:"replace_message_id"`
		}
		_ = json.NewDecoder(r.Body).Decode(&request)
		message := engine.Message{
			ID:        "turn-1",
			Role:      "user",
			Content:   request.Content,
			Status:    "pending",
			CreatedAt: "2026-07-16T00:00:00Z",
		}
		s.mu.Lock()
		s.beginReplaceMessageID = request.ReplaceMessageID
		s.conversationMessages = append(s.conversationMessages, message)
		s.mu.Unlock()
		writeTestJSON(w, http.StatusOK, message)
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
				ID:                       "assistant-authoritative",
				Role:                     "assistant",
				Content:                  request.Assistant.Content,
				Reasoning:                request.Assistant.Reasoning,
				ParentID:                 &parentID,
				ToolCalls:                request.Assistant.ToolCalls,
				TokenCount:               request.Assistant.TokenCount,
				InputTokens:              request.Assistant.InputTokens,
				OutputTokens:             request.Assistant.OutputTokens,
				CacheCreationInputTokens: request.Assistant.CacheCreationInputTokens,
				CacheReadInputTokens:     request.Assistant.CacheReadInputTokens,
				DurationMS:               request.Assistant.DurationMS,
				FinishReason:             request.Assistant.FinishReason,
				Status:                   request.Status,
				CreatedAt:                "2026-07-16T00:00:01Z",
			}
		}
		writeTestJSON(w, http.StatusOK, engine.FinalizeTurnResponse{
			UserMessage:      user,
			AssistantMessage: assistant,
		})
	case r.Method == http.MethodPost && r.URL.Path == "/api/memories":
		var request engine.RememberMemoryRequest
		_ = json.NewDecoder(r.Body).Decode(&request)
		s.mu.Lock()
		s.rememberRequests = append(s.rememberRequests, request)
		s.mu.Unlock()
		writeTestJSON(w, http.StatusCreated, engine.RememberedMemory{
			ID: "memory-1", GroupID: "character:character-default", State: "long_term", Kind: request.Kind, Created: true,
		})
	case r.Method == http.MethodPatch && r.URL.Path == "/api/conversations/c1":
		var request struct {
			Title string `json:"title"`
		}
		_ = json.NewDecoder(r.Body).Decode(&request)
		s.mu.Lock()
		s.conversationTitle = request.Title
		s.mu.Unlock()
		writeTestJSON(w, http.StatusOK, engine.Conversation{ID: "c1", Title: request.Title})
	default:
		http.Error(w, "unexpected engine request: "+r.Method+" "+r.URL.String(), http.StatusNotFound)
	}
}

func TestSendMessage_InlineEditTruncatesProviderHistoryAndReplacesTurn(t *testing.T) {
	gin.SetMode(gin.TestMode)
	stub := &chatEngineStub{conversationMessages: []engine.Message{
		{ID: "user-1", Role: "user", Content: "first"},
		{ID: "assistant-1", Role: "assistant", Content: "first answer"},
		{ID: "user-2", Role: "user", Content: "old question"},
		{ID: "assistant-2", Role: "assistant", Content: "old answer"},
	}}
	var providerMessages []provider.Message
	adapter := &scriptedAdapter{
		streamFn: func(_ context.Context, request *provider.ChatRequest, _ int) (<-chan provider.StreamEvent, error) {
			providerMessages = append([]provider.Message(nil), request.Messages...)
			return streamOf(provider.StreamEvent{Delta: &provider.DeltaEvent{FinishReason: "stop"}}), nil
		},
	}
	router, engineServer := newChatTestRouter(adapter, stub)
	defer engineServer.Close()

	request := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/conversations/c1/chat",
		bytes.NewBufferString(`{"content":"revised question","provider":"test","model":"model-test","stream":true,"replace_message_id":"user-2"}`),
	)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Provider-Key", "provider-key")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	stub.mu.Lock()
	replacedID := stub.beginReplaceMessageID
	stub.mu.Unlock()
	if replacedID != "user-2" {
		t.Fatalf("replace message id = %q", replacedID)
	}
	if len(providerMessages) != 3 || providerMessages[0].Content != "first" || providerMessages[1].Content != "first answer" || providerMessages[2].Content != "revised question" {
		t.Fatalf("provider history = %#v", providerMessages)
	}
}

func TestSendMessage_SlashWebSearchUsesConfiguredProviderBeforeLLM(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var searchFinished atomic.Bool
	searchServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if query := r.URL.Query().Get("q"); query != "搜索2026消息" {
			t.Fatalf("search query = %q", query)
		}
		searchFinished.Store(true)
		writeTestJSON(w, http.StatusOK, map[string]any{
			"results": []map[string]string{{
				"title":   "2026 update",
				"url":     "https://example.com/2026",
				"content": "Current result",
			}},
		})
	}))
	defer searchServer.Close()

	stub := &chatEngineStub{searchConfig: fmt.Sprintf(
		`{"enabled":false,"provider":"searxng","max_results":2,"searxng":{"endpoint":%q}}`,
		searchServer.URL,
	)}
	adapter := &scriptedAdapter{
		streamFn: func(_ context.Context, request *provider.ChatRequest, _ int) (<-chan provider.StreamEvent, error) {
			if !searchFinished.Load() {
				t.Fatal("LLM was called before Slash search completed")
			}
			if len(request.Messages) != 1 || request.Messages[0].Content != "/web_search 搜索2026消息" {
				t.Fatalf("original Slash request missing: %+v", request.Messages)
			}
			if !strings.Contains(request.SystemPrompt, "2026 update") || !strings.Contains(request.SystemPrompt, preexecutedToolPrompt) {
				t.Fatalf("search result missing from model context: %s", request.SystemPrompt)
			}
			for _, tool := range request.Tools {
				if tool.Function != nil && tool.Function.Name == "web_search" {
					t.Fatal("pre-executed web search was registered for duplicate execution")
				}
			}
			return streamOf(provider.StreamEvent{Delta: &provider.DeltaEvent{Content: "final answer", FinishReason: "stop"}}), nil
		},
	}
	router, engineServer := newChatTestRouter(adapter, stub)
	defer engineServer.Close()

	request := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/conversations/c1/chat",
		bytes.NewBufferString(`{"content":"/web_search 搜索2026消息","provider":"test","model":"model-test","stream":true,"search":false,"search_provider":"searxng"}`),
	)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Provider-Key", "provider-key")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	body := recorder.Body.String()
	if !strings.Contains(body, "event: tool_call") || !strings.Contains(body, "event: tool_result") ||
		!strings.Contains(body, `"name":"web_search"`) {
		t.Fatalf("Slash tool lifecycle missing from stream: %s", body)
	}
	finalizations := stub.finalizations()
	if len(finalizations) != 1 || finalizations[0].Assistant == nil ||
		len(finalizations[0].Assistant.ToolCalls) != 1 ||
		finalizations[0].Assistant.ToolCalls[0].Name != "web_search" ||
		finalizations[0].Assistant.ToolCalls[0].Status != "success" {
		t.Fatalf("Slash tool call was not persisted: %+v", finalizations)
	}
}

func TestSendMessage_SlashWebFetchReadsPageBeforeLLM(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var fetchFinished atomic.Bool
	pageServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/article" {
			t.Fatalf("page path = %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = io.WriteString(w, `<html><head><title>Example Article</title></head><body><main><p>Page content for the model.</p></main></body></html>`)
		fetchFinished.Store(true)
	}))
	defer pageServer.Close()

	pageURL := pageServer.URL + "/article"
	adapter := &scriptedAdapter{
		streamFn: func(_ context.Context, request *provider.ChatRequest, _ int) (<-chan provider.StreamEvent, error) {
			if !fetchFinished.Load() {
				t.Fatal("LLM was called before Slash page fetch completed")
			}
			if len(request.Messages) != 1 || request.Messages[0].Content != "/web_fetch "+pageURL {
				t.Fatalf("original Slash request missing: %+v", request.Messages)
			}
			if !strings.Contains(request.SystemPrompt, "Example Article") ||
				!strings.Contains(request.SystemPrompt, "Page content for the model.") ||
				!strings.Contains(request.SystemPrompt, preexecutedToolPrompt) {
				t.Fatalf("page content missing from model context: %s", request.SystemPrompt)
			}
			for _, tool := range request.Tools {
				if tool.Function != nil && tool.Function.Name == "web_fetch" {
					t.Fatal("pre-executed web fetch was registered for duplicate execution")
				}
			}
			return streamOf(provider.StreamEvent{Delta: &provider.DeltaEvent{Content: "page answer", FinishReason: "stop"}}), nil
		},
	}
	stub := &chatEngineStub{}
	router, engineServer := newChatTestRouter(adapter, stub)
	defer engineServer.Close()

	payload, err := json.Marshal(map[string]any{
		"content":  "/web_fetch " + pageURL,
		"provider": "test",
		"model":    "model-test",
		"stream":   true,
		"search":   false,
	})
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/conversations/c1/chat", bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Provider-Key", "provider-key")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	body := recorder.Body.String()
	if !strings.Contains(body, "event: tool_call") || !strings.Contains(body, "event: tool_result") ||
		!strings.Contains(body, `"name":"web_fetch"`) {
		t.Fatalf("Slash tool lifecycle missing from stream: %s", body)
	}
	finalizations := stub.finalizations()
	if len(finalizations) != 1 || finalizations[0].Assistant == nil ||
		len(finalizations[0].Assistant.ToolCalls) != 1 ||
		finalizations[0].Assistant.ToolCalls[0].Name != "web_fetch" ||
		finalizations[0].Assistant.ToolCalls[0].Status != "success" {
		t.Fatalf("Slash tool call was not persisted: %+v", finalizations)
	}
}

func (s *chatEngineStub) finalizations() []engine.FinalizeTurnRequest {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]engine.FinalizeTurnRequest(nil), s.finalizeRequests...)
}

func (s *chatEngineStub) remembered() []engine.RememberMemoryRequest {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]engine.RememberMemoryRequest(nil), s.rememberRequests...)
}

func (s *chatEngineStub) memoryQueries() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.memorySearchQueries...)
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

type titleEventRecorder struct {
	*httptest.ResponseRecorder
	titleEvent chan struct{}
	once       sync.Once
}

func (r *titleEventRecorder) Write(data []byte) (int, error) {
	if bytes.Contains(data, []byte("event: title_update")) {
		r.once.Do(func() { close(r.titleEvent) })
	}
	return r.ResponseRecorder.Write(data)
}

func (r *titleEventRecorder) Flush() {}

func TestSendMessage_FirstTurnStreamsTitleWhileAnswerIsGenerating(t *testing.T) {
	gin.SetMode(gin.TestMode)
	titleEvent := make(chan struct{})
	var titleWaitTimedOut atomic.Bool
	var invalidTitleRequest atomic.Bool
	adapter := &scriptedAdapter{
		chatFn: func(_ context.Context, request *provider.ChatRequest) (*provider.ChatResponse, error) {
			if request.Stream || !request.DisableReasoning {
				invalidTitleRequest.Store(true)
			}
			return &provider.ChatResponse{Content: "First Turn Title"}, nil
		},
		streamFn: func(_ context.Context, _ *provider.ChatRequest, _ int) (<-chan provider.StreamEvent, error) {
			events := make(chan provider.StreamEvent)
			go func() {
				defer close(events)
				events <- provider.StreamEvent{Delta: &provider.DeltaEvent{Content: "answer-start "}}
				select {
				case <-titleEvent:
				case <-time.After(2 * time.Second):
					titleWaitTimedOut.Store(true)
				}
				events <- provider.StreamEvent{Delta: &provider.DeltaEvent{Content: "answer-end", FinishReason: "stop"}}
			}()
			return events, nil
		},
	}
	stub := &chatEngineStub{conversationTitle: defaultConversationTitle}
	router, engineServer := newChatTestRouter(adapter, stub)
	defer engineServer.Close()

	request := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/conversations/c1/chat",
		bytes.NewBufferString(`{"content":"hello","provider":"test","model":"model-test","stream":true}`),
	)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Provider-Key", "provider-key")
	recorder := &titleEventRecorder{
		ResponseRecorder: httptest.NewRecorder(),
		titleEvent:       titleEvent,
	}
	router.ServeHTTP(recorder, request)

	if titleWaitTimedOut.Load() {
		t.Fatal("title_update was not streamed while the answer was still generating")
	}
	if invalidTitleRequest.Load() {
		t.Fatal("title request enabled streaming or reasoning")
	}
	body := recorder.Body.String()
	titleIndex := strings.Index(body, "event: title_update")
	answerEndIndex := strings.Index(body, "answer-end")
	doneIndex := strings.Index(body, "event: done")
	if titleIndex < 0 || answerEndIndex < 0 || doneIndex < 0 || titleIndex > answerEndIndex || answerEndIndex > doneIndex {
		t.Fatalf("unexpected first-turn event order: %s", body)
	}
	if adapter.chatCalls.Load() != 1 {
		t.Fatalf("title provider calls = %d, want 1", adapter.chatCalls.Load())
	}
}

func TestSendMessage_DoesNotGenerateAutomaticTitleAfterFirstTurn(t *testing.T) {
	gin.SetMode(gin.TestMode)
	stub := &chatEngineStub{
		conversationTitle: defaultConversationTitle,
		conversationMessages: []engine.Message{
			{ID: "user-old", Role: "user", Content: "first"},
			{ID: "assistant-old", Role: "assistant", Content: "answer"},
		},
	}
	adapter := &scriptedAdapter{
		chatFn: func(_ context.Context, _ *provider.ChatRequest) (*provider.ChatResponse, error) {
			return &provider.ChatResponse{Content: "Unexpected Title"}, nil
		},
		streamFn: func(_ context.Context, _ *provider.ChatRequest, _ int) (<-chan provider.StreamEvent, error) {
			return streamOf(provider.StreamEvent{Delta: &provider.DeltaEvent{Content: "next answer", FinishReason: "stop"}}), nil
		},
	}
	router, engineServer := newChatTestRouter(adapter, stub)
	defer engineServer.Close()

	recorder := performStreamRequest(t, router, context.Background())
	if adapter.chatCalls.Load() != 0 {
		t.Fatalf("title provider calls = %d, want 0", adapter.chatCalls.Load())
	}
	if strings.Contains(recorder.Body.String(), "event: title_update") {
		t.Fatalf("unexpected title update after first turn: %s", recorder.Body.String())
	}
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
			time.Sleep(3 * time.Millisecond)
			return streamOf(
				provider.StreamEvent{Delta: &provider.DeltaEvent{Content: "answer", FinishReason: "stop"}},
				provider.StreamEvent{Usage: &provider.UsageEvent{
					InputTokens: 2, OutputTokens: 3,
					CacheCreationInputTokens: 1, CacheReadInputTokens: 1,
				}},
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
	if done.Usage.CacheCreationInputTokens != 1 || done.Usage.CacheReadInputTokens != 1 {
		t.Fatalf("unexpected done cache usage: %+v", done.Usage)
	}
	if done.AssistantMessage.InputTokens == nil || *done.AssistantMessage.InputTokens != 2 ||
		done.AssistantMessage.OutputTokens == nil || *done.AssistantMessage.OutputTokens != 3 ||
		done.AssistantMessage.CacheCreationInputTokens == nil || *done.AssistantMessage.CacheCreationInputTokens != 1 ||
		done.AssistantMessage.CacheReadInputTokens == nil || *done.AssistantMessage.CacheReadInputTokens != 1 ||
		done.AssistantMessage.DurationMS == nil || *done.AssistantMessage.DurationMS <= 0 ||
		done.AssistantMessage.FinishReason == nil || *done.AssistantMessage.FinishReason != "stop" {
		t.Fatalf("missing persisted telemetry: %+v", done.AssistantMessage)
	}
	if !strings.Contains(body, `"duration_ms":`) {
		t.Fatalf("stream deltas did not expose live duration: %s", body)
	}

	requests := stub.finalizations()
	if len(requests) != 1 || requests[0].Status != "completed" {
		t.Fatalf("finalize requests = %+v", requests)
	}
	if requests[0].Assistant == nil || requests[0].Assistant.TokenCount != 5 ||
		requests[0].Assistant.InputTokens == nil || *requests[0].Assistant.InputTokens != 2 ||
		requests[0].Assistant.OutputTokens == nil || *requests[0].Assistant.OutputTokens != 3 ||
		requests[0].Assistant.CacheCreationInputTokens == nil || *requests[0].Assistant.CacheCreationInputTokens != 1 ||
		requests[0].Assistant.CacheReadInputTokens == nil || *requests[0].Assistant.CacheReadInputTokens != 1 {
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
				FinishReason:     "end_turn",
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
	if len(requests) != 1 || requests[0].Assistant == nil || requests[0].Assistant.TokenCount != 10 ||
		requests[0].Assistant.Reasoning != "reasoning" || requests[0].Assistant.InputTokens == nil ||
		*requests[0].Assistant.InputTokens != 4 || requests[0].Assistant.OutputTokens == nil ||
		*requests[0].Assistant.OutputTokens != 6 || requests[0].Assistant.DurationMS == nil ||
		requests[0].Assistant.FinishReason == nil || *requests[0].Assistant.FinishReason != "end_turn" {
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
	if requests[0].Assistant.FinishReason == nil || *requests[0].Assistant.FinishReason != "error" {
		t.Fatalf("provider error finish reason was not persisted: %+v", requests[0].Assistant)
	}
}

func TestSendMessage_ProviderAuthenticationFailureReturnsActionableSafeError(t *testing.T) {
	gin.SetMode(gin.TestMode)
	stub := &chatEngineStub{}
	adapter := &scriptedAdapter{
		streamFn: func(context.Context, *provider.ChatRequest, int) (<-chan provider.StreamEvent, error) {
			// Adapters reduce upstream failures to a status-only error before the
			// handler selects a safe, actionable client message.
			return nil, fmt.Errorf("deepseek stream: %w", provider.NewUpstreamHTTPError(http.StatusUnauthorized))
		},
	}
	router, engineServer := newChatTestRouter(adapter, stub)
	defer engineServer.Close()

	recorder := performStreamRequest(t, router, context.Background())
	var payload chatErrorPayload
	decodeSSEEvent(t, recorder.Body.String(), "error", &payload)
	if payload.Code != "provider_authentication_failed" || payload.Message != "Provider authentication failed. Check the API key." {
		t.Fatalf("unexpected authentication error payload: %+v", payload)
	}
	if strings.Contains(recorder.Body.String(), logCanary) {
		t.Fatalf("provider response leaked into SSE: %s", recorder.Body.String())
	}
}

func TestSendMessage_ProviderFailureWithoutOutputDoesNotCreateAssistant(t *testing.T) {
	gin.SetMode(gin.TestMode)
	stub := &chatEngineStub{}
	adapter := &scriptedAdapter{
		streamFn: func(context.Context, *provider.ChatRequest, int) (<-chan provider.StreamEvent, error) {
			return nil, errors.New("connection failed")
		},
	}
	router, engineServer := newChatTestRouter(adapter, stub)
	defer engineServer.Close()

	recorder := performStreamRequest(t, router, context.Background())
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	requests := stub.finalizations()
	if len(requests) != 1 || requests[0].Status != "failed" || requests[0].Assistant != nil {
		t.Fatalf("provider failure fabricated an assistant: %+v", requests)
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
	if requests[0].Assistant.FinishReason == nil || *requests[0].Assistant.FinishReason != "cancelled" {
		t.Fatalf("stop finish reason was not persisted: %+v", requests[0].Assistant)
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
					provider.StreamEvent{Delta: &provider.DeltaEvent{Content: "preface", FinishReason: "tool_calls"}},
					provider.StreamEvent{ToolCall: &provider.ToolCallEvent{
						Index: 0, ID: "title-call", Name: "update_conversation_title", Arguments: `{"title":"Renamed"}`,
					}},
					provider.StreamEvent{Usage: &provider.UsageEvent{InputTokens: 3}},
					provider.StreamEvent{Usage: &provider.UsageEvent{OutputTokens: 4}},
				), nil
			case 2:
				return streamOf(
					provider.StreamEvent{Delta: &provider.DeltaEvent{Content: "answer", FinishReason: "stop"}},
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
	if requests[0].Assistant.InputTokens == nil || *requests[0].Assistant.InputTokens != 8 ||
		requests[0].Assistant.OutputTokens == nil || *requests[0].Assistant.OutputTokens != 10 ||
		requests[0].Assistant.ContextInputTokens == nil || *requests[0].Assistant.ContextInputTokens != 5 ||
		requests[0].Assistant.ContextOutputTokens == nil || *requests[0].Assistant.ContextOutputTokens != 6 ||
		requests[0].Assistant.DurationMS == nil || requests[0].Assistant.FinishReason == nil ||
		*requests[0].Assistant.FinishReason != "stop" {
		t.Fatalf("tool-loop telemetry was not accumulated: %+v", requests[0].Assistant)
	}
	if len(requests[0].Assistant.ToolCalls) != 1 || requests[0].Assistant.ToolCalls[0].Status != "success" {
		t.Fatalf("executed tool call was not persisted authoritatively: %+v", requests[0].Assistant.ToolCalls)
	}
}

func TestSendMessage_MemoryToolUsesTrustedTurnProvenance(t *testing.T) {
	gin.SetMode(gin.TestMode)
	stub := &chatEngineStub{}
	adapter := &scriptedAdapter{
		streamFn: func(_ context.Context, request *provider.ChatRequest, call int) (<-chan provider.StreamEvent, error) {
			switch call {
			case 1:
				if !hasToolNamed(request.Tools, "memory_remember") {
					t.Fatal("memory_remember was not registered for streamed chat")
				}
				return streamOf(provider.StreamEvent{ToolCall: &provider.ToolCallEvent{
					Index:     0,
					ID:        "memory-call",
					Name:      "memory_remember",
					Arguments: `{"content":"The user leads release engineering.","kind":"fact","reason":"Stable responsibility","importance":0.9,"confidence":0.8,"conversation_id":"forged","character_id":"forged","source_turn_id":"forged","created_by_model":"forged"}`,
				}}), nil
			case 2:
				return streamOf(provider.StreamEvent{Delta: &provider.DeltaEvent{Content: "Understood.", FinishReason: "stop"}}), nil
			default:
				return nil, errors.New("unexpected extra tool round")
			}
		},
	}
	router, engineServer := newChatTestRouter(adapter, stub)
	defer engineServer.Close()

	recorder := performStreamRequest(t, router, context.Background())
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	requests := stub.remembered()
	if len(requests) != 1 {
		t.Fatalf("memory requests = %+v", requests)
	}
	request := requests[0]
	if request.ConversationID != "c1" || request.CharacterID != "character-default" ||
		request.SourceTurnID != "turn-1" || request.CreatedByModel != "model-test" {
		t.Fatalf("untrusted memory provenance reached Engine: %+v", request)
	}
	if request.Content != "The user leads release engineering." || request.Kind != "fact" {
		t.Fatalf("model-selected semantic fields were lost: %+v", request)
	}
}

func TestSendMessage_RAGSearchIsRestrictedToCharacterGroups(t *testing.T) {
	gin.SetMode(gin.TestMode)
	stub := &chatEngineStub{
		memoryMode: "rag",
		memoryResults: []engine.MemoryHit{{
			Content: "The user prefers concise technical answers.",
			Scope:   "global",
		}},
	}
	adapter := &scriptedAdapter{
		streamFn: func(_ context.Context, request *provider.ChatRequest, _ int) (<-chan provider.StreamEvent, error) {
			if !strings.Contains(request.SystemPrompt, "The user prefers concise technical answers.") {
				t.Fatalf("RAG memory missing from prompt: %s", request.SystemPrompt)
			}
			return streamOf(provider.StreamEvent{Delta: &provider.DeltaEvent{Content: "Answer", FinishReason: "stop"}}), nil
		},
	}
	router, engineServer := newChatTestRouter(adapter, stub)
	defer engineServer.Close()

	recorder := performStreamRequest(t, router, context.Background())
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	queries := stub.memoryQueries()
	if len(queries) != 1 || !strings.Contains(queries[0], "character_id=character-default") {
		t.Fatalf("memory search was not role-scoped: %v", queries)
	}
}

func TestSendMessage_SimpleMemorySearchRecallsAcrossConversations(t *testing.T) {
	gin.SetMode(gin.TestMode)
	stub := &chatEngineStub{
		memoryMode: "simple",
		memoryResults: []engine.MemoryHit{{
			Content: "User's name is Sam.",
			Scope:   "global",
		}},
	}
	adapter := &scriptedAdapter{
		streamFn: func(_ context.Context, request *provider.ChatRequest, call int) (<-chan provider.StreamEvent, error) {
			switch call {
			case 1:
				if !hasToolNamed(request.Tools, "memory_search") {
					t.Fatal("memory_search was not registered in Simple mode")
				}
				return streamOf(provider.StreamEvent{ToolCall: &provider.ToolCallEvent{
					Index: 0, ID: "memory-search-call", Name: "memory_search",
					Arguments: `{"query":"user name identity","top_k":5}`,
				}}), nil
			case 2:
				if len(request.Messages) < 2 || request.Messages[len(request.Messages)-1].Role != "tool" ||
					!strings.Contains(request.Messages[len(request.Messages)-1].Content, "Sam") {
					t.Fatalf("memory result missing from follow-up: %+v", request.Messages)
				}
				return streamOf(provider.StreamEvent{Delta: &provider.DeltaEvent{
					Content: "You are Sam.", FinishReason: "stop",
				}}), nil
			default:
				return nil, errors.New("unexpected extra tool round")
			}
		},
	}
	router, engineServer := newChatTestRouter(adapter, stub)
	defer engineServer.Close()

	recorder := performStreamRequest(t, router, context.Background())
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	queries := stub.memoryQueries()
	if len(queries) != 1 || !strings.Contains(queries[0], "character_id=character-default") ||
		!strings.Contains(queries[0], "retrieval=lexical") {
		t.Fatalf("Simple memory search was not lexical and role-scoped: %v", queries)
	}
	requests := stub.finalizations()
	if len(requests) != 1 || requests[0].Assistant == nil ||
		requests[0].Assistant.Content != "You are Sam." {
		t.Fatalf("cross-conversation recall was not persisted: %+v", requests)
	}
}

func hasToolNamed(tools []provider.Tool, name string) bool {
	for _, tool := range tools {
		if tool.Function != nil && tool.Function.Name == name {
			return true
		}
	}
	return false
}

func TestSendMessage_DisabledReasoningSuppressesUnexpectedProviderThinking(t *testing.T) {
	gin.SetMode(gin.TestMode)
	stub := &chatEngineStub{}
	adapter := &scriptedAdapter{
		streamFn: func(_ context.Context, request *provider.ChatRequest, _ int) (<-chan provider.StreamEvent, error) {
			if !request.DisableReasoning {
				t.Fatal("provider request did not disable reasoning")
			}
			// Some compatible gateways may ignore the request control; the client
			// still must not expose or persist reasoning while the UI switch is off.
			return streamOf(
				provider.StreamEvent{Reasoning: &provider.ReasoningEvent{Content: "hidden thought"}},
				provider.StreamEvent{Delta: &provider.DeltaEvent{Content: "answer", FinishReason: "stop"}},
			), nil
		},
	}
	router, engineServer := newChatTestRouter(adapter, stub)
	defer engineServer.Close()

	request := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/conversations/c1/chat",
		bytes.NewBufferString(`{"content":"hello","provider":"test","model":"model-test","stream":true,"disable_reasoning":true}`),
	)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Provider-Key", "provider-key")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	if strings.Contains(recorder.Body.String(), "event: reasoning") {
		t.Fatalf("disabled reasoning leaked into stream: %s", recorder.Body.String())
	}
	requests := stub.finalizations()
	if len(requests) != 1 || requests[0].Assistant == nil || requests[0].Assistant.Reasoning != "" {
		t.Fatalf("disabled reasoning was persisted: %+v", requests)
	}
}

func TestSendMessage_ToolFollowupDoesNotPersistDSMLProtocolText(t *testing.T) {
	gin.SetMode(gin.TestMode)
	stub := &chatEngineStub{}
	const leakedDSML = `<|DSML|><|tool_calls|><|DSML|><|invoke name="web_search"><|DSML|><|parameter name="query" string="true">world population</|DSML|></|invoke></|tool_calls>`
	adapter := &scriptedAdapter{
		streamFn: func(_ context.Context, req *provider.ChatRequest, call int) (<-chan provider.StreamEvent, error) {
			switch call {
			case 1:
				return streamOf(
					provider.StreamEvent{Delta: &provider.DeltaEvent{Content: leakedDSML[:20]}},
					provider.StreamEvent{Delta: &provider.DeltaEvent{Content: leakedDSML[20:]}},
					provider.StreamEvent{ToolCall: &provider.ToolCallEvent{
						Index:     0,
						ID:        "title-call",
						Name:      "update_conversation_title",
						Arguments: `{"title":"Population"}`,
					}},
				), nil
			case 2:
				if strings.Contains(req.SystemPrompt, "the tool is available") {
					return streamOf(provider.StreamEvent{Delta: &provider.DeltaEvent{Content: leakedDSML}}), nil
				}
				return streamOf(provider.StreamEvent{Delta: &provider.DeltaEvent{
					Content: "The requested population table is ready.", FinishReason: "stop",
				}}), nil
			default:
				return nil, errors.New("unexpected extra tool round")
			}
		},
	}
	router, engineServer := newChatTestRouter(adapter, stub)
	defer engineServer.Close()

	recorder := performStreamRequest(t, router, context.Background())
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if strings.Contains(recorder.Body.String(), "DSML") {
		t.Fatalf("tool protocol leaked into SSE stream: %s", recorder.Body.String())
	}
	requests := stub.finalizations()
	if len(requests) != 1 || requests[0].Assistant == nil {
		t.Fatalf("unexpected finalization: %+v", requests)
	}
	if strings.Contains(requests[0].Assistant.Content, "DSML") {
		t.Fatalf("tool protocol leaked into assistant content: %q", requests[0].Assistant.Content)
	}
	if requests[0].Assistant.Content != "The requested population table is ready." {
		t.Fatalf("unexpected assistant content: %q", requests[0].Assistant.Content)
	}
}

func TestSendMessage_RetriesEmptyToolFollowupOnce(t *testing.T) {
	gin.SetMode(gin.TestMode)
	stub := &chatEngineStub{}
	adapter := &scriptedAdapter{
		streamFn: func(_ context.Context, _ *provider.ChatRequest, call int) (<-chan provider.StreamEvent, error) {
			switch call {
			case 1:
				return streamOf(provider.StreamEvent{ToolCall: &provider.ToolCallEvent{
					Index: 0, ID: "title-call", Name: "update_conversation_title", Arguments: `{"title":"Recovered"}`,
				}}), nil
			case 2:
				return streamOf(provider.StreamEvent{Delta: &provider.DeltaEvent{FinishReason: "stop"}}), nil
			case 3:
				return streamOf(provider.StreamEvent{Delta: &provider.DeltaEvent{
					Content: "Recovered answer.", FinishReason: "stop",
				}}), nil
			default:
				return nil, errors.New("unexpected extra tool follow-up")
			}
		},
	}
	router, engineServer := newChatTestRouter(adapter, stub)
	defer engineServer.Close()

	recorder := performStreamRequest(t, router, context.Background())
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if adapter.streamCalls.Load() != 3 {
		t.Fatalf("stream calls = %d, want one bounded retry", adapter.streamCalls.Load())
	}
	requests := stub.finalizations()
	if len(requests) != 1 || requests[0].Status != "completed" || requests[0].Assistant == nil ||
		requests[0].Assistant.Content != "Recovered answer." {
		t.Fatalf("empty follow-up was not recovered: %+v", requests)
	}
}

func TestSendMessage_FailsRepeatedEmptyToolFollowup(t *testing.T) {
	gin.SetMode(gin.TestMode)
	stub := &chatEngineStub{}
	adapter := &scriptedAdapter{
		streamFn: func(_ context.Context, _ *provider.ChatRequest, call int) (<-chan provider.StreamEvent, error) {
			if call == 1 {
				return streamOf(provider.StreamEvent{ToolCall: &provider.ToolCallEvent{
					Index: 0, ID: "title-call", Name: "update_conversation_title", Arguments: `{"title":"Empty"}`,
				}}), nil
			}
			return streamOf(provider.StreamEvent{Delta: &provider.DeltaEvent{FinishReason: "stop"}}), nil
		},
	}
	router, engineServer := newChatTestRouter(adapter, stub)
	defer engineServer.Close()

	recorder := performStreamRequest(t, router, context.Background())
	if adapter.streamCalls.Load() != 3 {
		t.Fatalf("stream calls = %d, retry was not bounded", adapter.streamCalls.Load())
	}
	if body := recorder.Body.String(); !strings.Contains(body, "event: error") ||
		!strings.Contains(body, `"code":"empty_response"`) {
		t.Fatalf("repeated empty response did not produce a terminal error: %s", body)
	}
	requests := stub.finalizations()
	if len(requests) != 1 || requests[0].Status != "failed" {
		t.Fatalf("repeated empty response was not finalized as failed: %+v", requests)
	}
}

func TestSendMessage_FailsWhenToolFollowupOnlyContainsProtocolText(t *testing.T) {
	gin.SetMode(gin.TestMode)
	const protocolOnly = `<|DSML|><|tool_calls|><|DSML|><|invoke name="web_search"><|DSML|><|parameter name="query" string="true">ignored</|DSML|></|invoke></|tool_calls>`
	stub := &chatEngineStub{}
	adapter := &scriptedAdapter{
		streamFn: func(_ context.Context, _ *provider.ChatRequest, call int) (<-chan provider.StreamEvent, error) {
			if call == 1 {
				return streamOf(provider.StreamEvent{ToolCall: &provider.ToolCallEvent{
					Index: 0, ID: "title-call", Name: "update_conversation_title", Arguments: `{"title":"Protocol only"}`,
				}}), nil
			}
			return streamOf(provider.StreamEvent{Delta: &provider.DeltaEvent{
				Content: protocolOnly, FinishReason: "stop",
			}}), nil
		},
	}
	router, engineServer := newChatTestRouter(adapter, stub)
	defer engineServer.Close()

	recorder := performStreamRequest(t, router, context.Background())
	if adapter.streamCalls.Load() != 3 {
		t.Fatalf("stream calls = %d, cleaned-empty retry was not bounded", adapter.streamCalls.Load())
	}
	if body := recorder.Body.String(); !strings.Contains(body, "event: error") ||
		!strings.Contains(body, `"code":"empty_response"`) {
		t.Fatalf("protocol-only response did not produce a terminal error: %s", body)
	}
	requests := stub.finalizations()
	if len(requests) != 1 || requests[0].Status != "failed" {
		t.Fatalf("protocol-only response was not finalized as failed: %+v", requests)
	}
}

func TestSendMessage_RetriesIncompleteToolFollowupAnnouncement(t *testing.T) {
	gin.SetMode(gin.TestMode)
	stub := &chatEngineStub{}
	adapter := &scriptedAdapter{
		streamFn: func(_ context.Context, request *provider.ChatRequest, call int) (<-chan provider.StreamEvent, error) {
			switch call {
			case 1:
				return streamOf(provider.StreamEvent{ToolCall: &provider.ToolCallEvent{
					Index: 0, ID: "title-call", Name: "update_conversation_title", Arguments: `{"title":"BV numbers"}`,
				}}), nil
			case 2:
				return streamOf(provider.StreamEvent{Delta: &provider.DeltaEvent{
					Content: "我来重新抓取页面获取 BV 号。", FinishReason: "stop",
				}}), nil
			case 3:
				if !strings.Contains(request.SystemPrompt, "Do not announce another action") {
					t.Fatalf("repair instruction missing: %s", request.SystemPrompt)
				}
				return streamOf(provider.StreamEvent{Delta: &provider.DeltaEvent{
					Content: "排行榜第一名的 BV 号是 BV1Unub69EpX。", FinishReason: "stop",
				}}), nil
			default:
				return nil, errors.New("unexpected extra tool follow-up")
			}
		},
	}
	router, engineServer := newChatTestRouter(adapter, stub)
	defer engineServer.Close()

	recorder := performStreamRequest(t, router, context.Background())
	if adapter.streamCalls.Load() != 3 {
		t.Fatalf("stream calls = %d, want one repair retry", adapter.streamCalls.Load())
	}
	var done chatDonePayload
	decodeSSEEvent(t, recorder.Body.String(), "done", &done)
	if done.AssistantMessage == nil ||
		done.AssistantMessage.Content != "排行榜第一名的 BV 号是 BV1Unub69EpX。" {
		t.Fatalf("incomplete announcement was persisted: %+v", done.AssistantMessage)
	}
}

func TestSendMessage_WebFetchCanContinueToSpecificAPI(t *testing.T) {
	gin.SetMode(gin.TestMode)
	pageServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/ranking":
			w.Header().Set("Content-Type", "text/html")
			_, _ = io.WriteString(w, `<html><body><main>Ranking shell</main></body></html>`)
		case "/api/ranking":
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"list":[{"bvid":"BV1Unub69EpX"}]}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer pageServer.Close()

	stub := &chatEngineStub{searchConfig: `{"enabled":true,"provider":"duckduckgo","max_results":5}`}
	adapter := &scriptedAdapter{
		streamFn: func(_ context.Context, request *provider.ChatRequest, call int) (<-chan provider.StreamEvent, error) {
			switch call {
			case 1:
				return streamOf(provider.StreamEvent{ToolCall: &provider.ToolCallEvent{
					Index: 0, ID: "fetch-page", Name: "web_fetch",
					Arguments: fmt.Sprintf(`{"url":%q}`, pageServer.URL+"/ranking"),
				}}), nil
			case 2:
				if !hasToolNamed(request.Tools, "web_fetch") || hasToolNamed(request.Tools, "web_search") {
					t.Fatalf("follow-up tools = %+v", request.Tools)
				}
				return streamOf(provider.StreamEvent{ToolCall: &provider.ToolCallEvent{
					Index: 0, ID: "fetch-api", Name: "web_fetch",
					Arguments: fmt.Sprintf(`{"url":%q}`, pageServer.URL+"/api/ranking"),
				}}), nil
			case 3:
				if !strings.Contains(request.Messages[len(request.Messages)-1].Content, "BV1Unub69EpX") {
					t.Fatalf("API result missing from final follow-up: %+v", request.Messages)
				}
				return streamOf(provider.StreamEvent{Delta: &provider.DeltaEvent{
					Content: "第一名的 BV 号是 BV1Unub69EpX。", FinishReason: "stop",
				}}), nil
			default:
				return nil, errors.New("unexpected extra web tool round")
			}
		},
	}
	router, engineServer := newChatTestRouter(adapter, stub)
	defer engineServer.Close()

	request := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/conversations/c1/chat",
		bytes.NewBufferString(`{"content":"获取 BV 号","provider":"test","model":"model-test","stream":true,"search":true,"search_provider":"duckduckgo"}`),
	)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Provider-Key", "provider-key")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	var done chatDonePayload
	decodeSSEEvent(t, recorder.Body.String(), "done", &done)
	if done.AssistantMessage == nil || done.AssistantMessage.Content != "第一名的 BV 号是 BV1Unub69EpX。" ||
		len(done.AssistantMessage.ToolCalls) != 2 {
		t.Fatalf("web fetch chain was not completed: %+v", done.AssistantMessage)
	}
}

func TestSendMessage_EmptyDuckDuckGoDoesNotEnableGuessedFetches(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var instantAnswerRequests atomic.Int32
	var htmlRequests atomic.Int32
	stub := &chatEngineStub{
		searchConfig: `{"enabled":true,"provider":"duckduckgo","max_results":5}`,
		networkFetch: func(rawURL string) engine.NetworkFetchResponse {
			response := engine.NetworkFetchResponse{
				Status: 200, FinalURL: rawURL, Backend: "curl",
			}
			if strings.Contains(rawURL, "api.duckduckgo.com") {
				instantAnswerRequests.Add(1)
				response.ContentType = "application/json"
				response.Body = `{}`
				return response
			}
			htmlRequests.Add(1)
			response.ContentType = "text/html"
			response.Body = `<html><body><div class="no-results">No results</div></body></html>`
			return response
		},
	}
	adapter := &scriptedAdapter{
		streamFn: func(_ context.Context, request *provider.ChatRequest, call int) (<-chan provider.StreamEvent, error) {
			switch call {
			case 1:
				return streamOf(provider.StreamEvent{ToolCall: &provider.ToolCallEvent{
					Index: 0, ID: "search-anime", Name: "web_search",
					Arguments: `{"query":"2026年7月新番 アニメ一覧"}`,
				}}), nil
			case 2:
				if hasToolNamed(request.Tools, "web_fetch") || hasToolNamed(request.Tools, "web_search") {
					t.Fatalf("failed DuckDuckGo search exposed another network tool: %+v", request.Tools)
				}
				if !strings.Contains(request.SystemPrompt, "Do not guess or fabricate URLs") ||
					!strings.Contains(request.SystemPrompt, "No further network tool is available") {
					t.Fatalf("search failure instruction missing: %s", request.SystemPrompt)
				}
				return streamOf(provider.StreamEvent{Delta: &provider.DeltaEvent{
					Content:      "DuckDuckGo 的网页结果与精选摘要均未返回可靠内容。",
					FinishReason: "stop",
				}}), nil
			default:
				return nil, errors.New("unexpected extra tool round")
			}
		},
	}
	router, engineServer := newChatTestRouter(adapter, stub)
	defer engineServer.Close()

	request := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/conversations/c1/chat",
		bytes.NewBufferString(`{"content":"2026下半年新番","provider":"test","model":"model-test","stream":true,"search":true,"search_provider":"duckduckgo"}`),
	)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Provider-Key", "provider-key")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	var done chatDonePayload
	decodeSSEEvent(t, recorder.Body.String(), "done", &done)
	if done.AssistantMessage == nil ||
		done.AssistantMessage.Content != "DuckDuckGo 的网页结果与精选摘要均未返回可靠内容。" ||
		len(done.AssistantMessage.ToolCalls) != 1 {
		t.Fatalf("unexpected failed-search finalization: %+v", done.AssistantMessage)
	}
	if instantAnswerRequests.Load() != 1 || htmlRequests.Load() != 1 {
		t.Fatalf(
			"DuckDuckGo source requests = instant:%d HTML:%d, want one each",
			instantAnswerRequests.Load(),
			htmlRequests.Load(),
		)
	}
}

func TestSendMessage_WebFetchAttemptsAreHardLimited(t *testing.T) {
	requests := 0
	pageServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests++
		w.Header().Set("Content-Type", "text/plain")
		_, _ = io.WriteString(w, "page")
	}))
	defer pageServer.Close()

	stub := &chatEngineStub{searchConfig: `{"enabled":true,"provider":"duckduckgo","max_results":5}`}
	adapter := &scriptedAdapter{
		streamFn: func(_ context.Context, request *provider.ChatRequest, call int) (<-chan provider.StreamEvent, error) {
			switch call {
			case 1, 2:
				if call == 2 && !hasToolNamed(request.Tools, "web_fetch") {
					t.Fatalf("web_fetch unavailable before limit on call %d", call)
				}
				first := (call-1)*2 + 1
				return streamOf(
					provider.StreamEvent{ToolCall: &provider.ToolCallEvent{
						Index: 0, ID: fmt.Sprintf("fetch-%d", first), Name: "web_fetch",
						Arguments: fmt.Sprintf(`{"url":%q}`, fmt.Sprintf("%s/page-%d", pageServer.URL, first)),
					}},
					provider.StreamEvent{ToolCall: &provider.ToolCallEvent{
						Index: 1, ID: fmt.Sprintf("fetch-%d", first+1), Name: "web_fetch",
						Arguments: fmt.Sprintf(`{"url":%q}`, fmt.Sprintf("%s/page-%d", pageServer.URL, first+1)),
					}},
				), nil
			case 3:
				if hasToolNamed(request.Tools, "web_fetch") {
					t.Fatalf("web_fetch remained available after three attempts: %+v", request.Tools)
				}
				return streamOf(provider.StreamEvent{Delta: &provider.DeltaEvent{
					Content: "抓取次数已达到上限。", FinishReason: "stop",
				}}), nil
			default:
				return nil, errors.New("unexpected extra tool round")
			}
		},
	}
	router, engineServer := newChatTestRouter(adapter, stub)
	defer engineServer.Close()

	request := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/conversations/c1/chat",
		bytes.NewBufferString(`{"content":"抓取三个页面","provider":"test","model":"model-test","stream":true,"search":true,"search_provider":"duckduckgo"}`),
	)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Provider-Key", "provider-key")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	var done chatDonePayload
	decodeSSEEvent(t, recorder.Body.String(), "done", &done)
	if done.AssistantMessage == nil || len(done.AssistantMessage.ToolCalls) != 4 {
		t.Fatalf("fetch attempts were not bounded at three: %+v", done.AssistantMessage)
	}
	if requests != 3 {
		t.Fatalf("network fetch requests = %d, want hard limit of three", requests)
	}
	last := done.AssistantMessage.ToolCalls[3]
	if last.Status != "error" || !strings.Contains(last.Result, "limit") {
		t.Fatalf("fourth fetch was not rejected explicitly: %+v", last)
	}
}

func TestSendMessage_ExecutesTextOnlyDSMLToolCall(t *testing.T) {
	gin.SetMode(gin.TestMode)
	const dsmlCall = `<｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name="web_search"><｜｜DSML｜｜parameter name="query" string="true">nginx 1.26.1 vulnerabilities CVE</｜｜DSML｜｜parameter></｜｜DSML｜｜invoke></｜｜DSML｜｜tool_calls>`

	searchServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if query := r.URL.Query().Get("q"); query != "nginx 1.26.1 vulnerabilities CVE" {
			t.Fatalf("search query = %q", query)
		}
		writeTestJSON(w, http.StatusOK, map[string]any{
			"results": []map[string]string{{
				"title": "Population source", "url": "https://example.com/population", "content": "Current data",
			}},
		})
	}))
	t.Cleanup(searchServer.Close)

	stub := &chatEngineStub{searchConfig: fmt.Sprintf(
		`{"enabled":true,"provider":"searxng","max_results":2,"searxng":{"endpoint":%q}}`,
		searchServer.URL,
	)}
	adapter := &scriptedAdapter{
		streamFn: func(_ context.Context, request *provider.ChatRequest, call int) (<-chan provider.StreamEvent, error) {
			switch call {
			case 1:
				// Some compatible gateways encode a tool request only in the text delta.
				return streamOf(
					provider.StreamEvent{Delta: &provider.DeltaEvent{Content: dsmlCall[:24]}},
					provider.StreamEvent{Delta: &provider.DeltaEvent{Content: dsmlCall[24:], FinishReason: "stop"}},
				), nil
			case 2:
				if len(request.Messages) < 2 || len(request.Messages[len(request.Messages)-2].ToolCalls) != 1 ||
					request.Messages[len(request.Messages)-1].Role != "tool" {
					t.Fatalf("parsed tool call was not supplied to follow-up: %+v", request.Messages)
				}
				return streamOf(provider.StreamEvent{Delta: &provider.DeltaEvent{
					Content: "The requested population data is ready.", FinishReason: "stop",
				}}), nil
			default:
				return nil, errors.New("unexpected extra tool round")
			}
		},
	}
	router, engineServer := newChatTestRouter(adapter, stub)
	defer engineServer.Close()

	request := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/conversations/c1/chat",
		bytes.NewBufferString(`{"content":"hello","provider":"test","model":"model-test","stream":true,"search":true,"search_provider":"searxng"}`),
	)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Provider-Key", "provider-key")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	body := recorder.Body.String()
	if strings.Contains(body, "DSML") || !strings.Contains(body, `"name":"web_search"`) {
		t.Fatalf("text protocol was not normalized into a tool event: %s", body)
	}
	requests := stub.finalizations()
	if len(requests) != 1 || requests[0].Assistant == nil ||
		requests[0].Assistant.Content != "The requested population data is ready." ||
		len(requests[0].Assistant.ToolCalls) != 1 || requests[0].Assistant.ToolCalls[0].Status != "success" {
		t.Fatalf("unexpected finalization: %+v", requests)
	}
}

func TestSendMessage_ToolFollowupFiltersDSMLWhenProviderIgnoresPrompt(t *testing.T) {
	gin.SetMode(gin.TestMode)
	stub := &chatEngineStub{}
	const leakedDSML = `<|DSML|><|tool_calls|><|DSML|><|invoke name="web_search"><|DSML|><|parameter name="query" string="true">world population</|DSML|></|invoke></|tool_calls>`
	adapter := &scriptedAdapter{
		streamFn: func(_ context.Context, _ *provider.ChatRequest, call int) (<-chan provider.StreamEvent, error) {
			switch call {
			case 1:
				return streamOf(provider.StreamEvent{ToolCall: &provider.ToolCallEvent{
					Index: 0, ID: "title-call", Name: "update_conversation_title", Arguments: `{"title":"Population"}`,
				}}), nil
			case 2:
				return streamOf(provider.StreamEvent{Delta: &provider.DeltaEvent{
					Content: leakedDSML + "\n\nFallback answer.", FinishReason: "stop",
				}}), nil
			default:
				return nil, errors.New("unexpected extra tool round")
			}
		},
	}
	router, engineServer := newChatTestRouter(adapter, stub)
	defer engineServer.Close()

	recorder := performStreamRequest(t, router, context.Background())
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if strings.Contains(recorder.Body.String(), "DSML") {
		t.Fatalf("tool protocol leaked into SSE stream: %s", recorder.Body.String())
	}
	requests := stub.finalizations()
	if len(requests) != 1 || requests[0].Assistant == nil || requests[0].Assistant.Content != "Fallback answer." {
		t.Fatalf("unexpected finalization: %+v", requests)
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
