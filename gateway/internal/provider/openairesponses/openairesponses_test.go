package openairesponses

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"com.0d000721.encorehub/gateway/internal/provider"
)

func TestAdapterChatUsesResponsesShape(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/responses" || r.Method != http.MethodPost {
			t.Fatalf("request = %s %s", r.Method, r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-key" {
			t.Fatalf("authorization = %q", got)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["input"] == nil || body["instructions"] != "be concise" || body["max_output_tokens"] != float64(42) {
			t.Fatalf("unexpected request body: %#v", body)
		}
		input := body["input"].([]any)
		message := input[0].(map[string]any)
		if message["type"] != "message" || message["role"] != "user" {
			t.Fatalf("unexpected input message: %#v", message)
		}
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"id":"resp_1","model":"gpt-5","status":"completed","output_text":"hello","usage":{"input_tokens":12,"output_tokens":3,"input_tokens_details":{"cached_tokens":2}}}`)
	}))
	defer server.Close()

	adapter := New(provider.ProviderProfile{ID: "responses", BaseURL: server.URL + "/v1", Models: []string{"gpt-5"}})
	response, err := adapter.Chat(context.Background(), &provider.ChatRequest{Model: "gpt-5", SystemPrompt: "be concise", MaxTokens: 42, Messages: []provider.Message{{Role: "user", Content: "hi"}}}, "test-key")
	if err != nil {
		t.Fatal(err)
	}
	if response.Content != "hello" || response.FinishReason != "stop" || response.InputTokens != 12 || response.CacheReadInputTokens != 2 {
		t.Fatalf("unexpected response: %#v", response)
	}
}

func TestAdapterChatStreamMapsEvents(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		io.WriteString(w, "event: response.output_text.delta\ndata: {\"delta\":\"hi\"}\n\n")
		io.WriteString(w, "event: response.function_call_arguments.done\ndata: {\"item_id\":\"fc_1\",\"name\":\"lookup\",\"arguments\":\"{}\"}\n\n")
		io.WriteString(w, "event: response.completed\ndata: {\"response\":{\"status\":\"completed\",\"usage\":{\"input_tokens\":4,\"output_tokens\":2}}}\n\n")
	}))
	defer server.Close()
	adapter := New(provider.ProviderProfile{ID: "responses", BaseURL: server.URL + "/v1", Models: []string{"gpt-5"}})
	events, err := adapter.ChatStream(context.Background(), &provider.ChatRequest{Model: "gpt-5"}, "key")
	if err != nil {
		t.Fatal(err)
	}
	var content, finish string
	var tool *provider.ToolCallEvent
	var usage *provider.UsageEvent
	for event := range events {
		if event.Delta != nil { content += event.Delta.Content; finish = event.Delta.FinishReason }
		if event.ToolCall != nil { tool = event.ToolCall }
		if event.Usage != nil { usage = event.Usage }
		if event.Error != nil { t.Fatal(event.Error) }
	}
	if content != "hi" || finish != "stop" || tool == nil || tool.ID != "fc_1" || tool.Name != "lookup" || usage == nil || usage.InputTokens != 4 {
		t.Fatalf("unexpected stream result: content=%q finish=%q tool=%#v usage=%#v", content, finish, tool, usage)
	}
}

func TestClientDelete(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete || r.URL.Path != "/v1/responses/resp_123" { t.Fatalf("request = %s %s", r.Method, r.URL.Path) }
		if r.Header.Get("Authorization") != "Bearer key" { t.Fatalf("missing auth") }
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"id":"resp_123","object":"response","deleted":true}`)
	}))
	defer server.Close()
	client := NewClient(server.URL+"/v1", nil)
	deleted, err := client.Delete(context.Background(), "resp_123", "key")
	if err != nil || deleted == nil || !deleted.Deleted || !strings.HasPrefix(deleted.ID, "resp_") { t.Fatalf("delete = %#v, err=%v", deleted, err) }
}
