package gemini

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"com.0d000721.encorehub/gateway/internal/provider"
)

func newProfile(base string) provider.ProviderProfile {
	return provider.ProviderProfile{
		ID:       "gemini",
		Name:     "Google Gemini",
		Protocol: provider.ProtocolGemini,
		BaseURL:  base,
		Models:   []string{"gemini-3.8-flash"},
		Enabled:  true,
	}
}

func TestBuildInteractionRequestMapsHistoryToolsAndConfig(t *testing.T) {
	temperature := float32(0.4)
	request := &provider.ChatRequest{
		Model:        "gemini-3.8-flash",
		SystemPrompt: "Be helpful.",
		Messages: []provider.Message{
			{Role: "system", Content: "Extra rules."},
			{Role: "user", Content: "weather?"},
			{Role: "assistant", Content: "Checking.", ToolCalls: []provider.ToolCallMessage{
				{ID: "call-1", Name: "get_weather", Arguments: `{"city":"Paris"}`},
			}},
			{Role: "tool", Content: "sunny", ToolCallID: "call-1"},
		},
		Temperature:         temperature,
		MaxCompletionTokens: 512,
		ReasoningEffort:     "high",
		Tools: []provider.Tool{{
			Type: "function",
			Function: &provider.FunctionDefinition{
				Name:        "get_weather",
				Description: "Look up weather",
				Parameters:  map[string]any{"type": "object"},
			},
		}},
	}

	body, err := buildInteractionRequest(request)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if body.Store || body.Stream {
		t.Fatalf("stateless requests must not store or stream: %+v", body)
	}
	if !strings.Contains(body.SystemInstruction, "Be helpful.") ||
		!strings.Contains(body.SystemInstruction, "Extra rules.") {
		t.Fatalf("system instruction lost content: %q", body.SystemInstruction)
	}
	if body.GenerationConfig == nil || body.GenerationConfig.ThinkingLevel != "high" ||
		body.GenerationConfig.MaxOutputTokens == nil || *body.GenerationConfig.MaxOutputTokens != 512 {
		t.Fatalf("generation config not mapped: %+v", body.GenerationConfig)
	}

	steps, ok := body.Input.([]interactionStep)
	if !ok {
		t.Fatalf("input must be typed steps, got %T", body.Input)
	}
	want := []string{"user_input", "model_output", "function_call", "function_result"}
	if len(steps) != len(want) {
		t.Fatalf("steps = %+v", steps)
	}
	for index, kind := range want {
		if steps[index].Type != kind {
			t.Fatalf("step %d = %q, want %q", index, steps[index].Type, kind)
		}
	}
	if steps[2].ID != "call-1" || steps[2].Name != "get_weather" ||
		!strings.Contains(string(steps[2].Arguments), "Paris") {
		t.Fatalf("function_call step = %+v", steps[2])
	}
	if steps[3].CallID != "call-1" || steps[3].Name != "get_weather" {
		t.Fatalf("function_result must resolve the call name: %+v", steps[3])
	}
	if len(body.Tools) != 1 || body.Tools[0].Type != "function" || body.Tools[0].Name != "get_weather" {
		t.Fatalf("tools = %+v", body.Tools)
	}
}

func TestChatMapsStepsReasoningAndUsage(t *testing.T) {
	var captured interactionRequest
	var apiKey string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		apiKey = r.Header.Get("x-goog-api-key")
		if r.URL.Path != "/v1beta/interactions" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		_ = json.NewDecoder(r.Body).Decode(&captured)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"id":"int-1","status":"completed",
			"usage":{"input_tokens":120,"output_tokens":30,"cached_content_token_count":80},
			"steps":[
				{"type":"thought","content":[{"type":"text","text":"weighing options"}]},
				{"type":"model_output","content":[{"type":"text","text":"Hello "},{"type":"text","text":"world"}]}
			]}`))
	}))
	defer server.Close()

	adapter := New(newProfile(server.URL + "/v1beta"))
	response, err := adapter.Chat(context.Background(), &provider.ChatRequest{
		Model:    "gemini-3.8-flash",
		Messages: []provider.Message{{Role: "user", Content: "hi"}},
	}, "secret-key")
	if err != nil {
		t.Fatalf("chat: %v", err)
	}
	if apiKey != "secret-key" {
		t.Fatalf("api key header = %q", apiKey)
	}
	if response.Content != "Hello world" || response.ReasoningContent != "weighing options" {
		t.Fatalf("unexpected response: %+v", response)
	}
	if response.FinishReason != "stop" || response.InputTokens != 120 ||
		response.OutputTokens != 30 || response.CacheReadInputTokens != 80 {
		t.Fatalf("usage or finish reason not mapped: %+v", response)
	}
	// The captured body is wire JSON, so steps decode as generic maps.
	steps, ok := captured.Input.([]any)
	if !ok || len(steps) != 1 {
		t.Fatalf("captured input = %+v", captured.Input)
	}
	first, _ := steps[0].(map[string]any)
	if first["type"] != "user_input" {
		t.Fatalf("captured step = %+v", first)
	}
}

func TestChatStreamMapsStepEvents(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("alt") != "sse" {
			t.Fatalf("streaming must request SSE: %q", r.URL.RawQuery)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		frames := []string{
			`data: {"event_type":"step.start","index":0,"step":{"type":"function_call","id":"call-1","name":"get_weather"}}`,
			`data: {"event_type":"step.delta","index":0,"delta":{"type":"arguments_delta","arguments":"{\"city\":"}}`,
			`data: {"event_type":"step.delta","index":0,"delta":{"type":"arguments_delta","arguments":"\"Paris\"}"}}`,
			`data: {"event_type":"step.delta","index":1,"delta":{"type":"thought","thought":"hmm"}}`,
			`data: {"event_type":"step.delta","index":2,"delta":{"type":"text","text":"Sunny."}}`,
			`data: {"event_type":"interaction.completed","interaction":{"status":"completed","usage":{"input_tokens":10,"output_tokens":4}}}`,
		}
		_, _ = w.Write([]byte(strings.Join(frames, "\n\n") + "\n\n"))
	}))
	defer server.Close()

	adapter := New(newProfile(server.URL + "/v1beta"))
	events, err := adapter.ChatStream(context.Background(), &provider.ChatRequest{
		Model:    "gemini-3.8-flash",
		Messages: []provider.Message{{Role: "user", Content: "weather?"}},
		Stream:   true,
	}, "secret-key")
	if err != nil {
		t.Fatalf("stream: %v", err)
	}

	var (
		toolName   string
		arguments  string
		reasoning  string
		content    string
		finish     string
		inputToken int
		outputTok  int
	)
	for event := range events {
		switch {
		case event.Error != nil:
			t.Fatalf("stream error: %v", event.Error)
		case event.ToolCall != nil:
			if event.ToolCall.Name != "" {
				toolName = event.ToolCall.Name
			}
			arguments += event.ToolCall.Arguments
		case event.Reasoning != nil:
			reasoning += event.Reasoning.Content
		case event.Delta != nil:
			if event.Delta.FinishReason != "" {
				finish = event.Delta.FinishReason
			}
			content += event.Delta.Content
		case event.Usage != nil:
			inputToken = event.Usage.InputTokens
			outputTok = event.Usage.OutputTokens
		}
	}

	if toolName != "get_weather" || arguments != `{"city":"Paris"}` {
		t.Fatalf("tool call not mapped: name=%q args=%q", toolName, arguments)
	}
	if reasoning != "hmm" || content != "Sunny." || finish != "stop" {
		t.Fatalf("text mapping wrong: reasoning=%q content=%q finish=%q", reasoning, content, finish)
	}
	if inputToken != 10 || outputTok != 4 {
		t.Fatalf("usage not mapped: %d/%d", inputToken, outputTok)
	}
}

func TestListModelsStripsResourcePrefix(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1beta/models" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"models":[{"name":"models/gemini-3.8-flash","displayName":"Gemini 3.8 Flash"}]}`))
	}))
	defer server.Close()

	models, err := New(newProfile(server.URL+"/v1beta")).ListModels(context.Background(), "key")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(models) != 1 || models[0].ID != "gemini-3.8-flash" || models[0].Name != "Gemini 3.8 Flash" {
		t.Fatalf("models = %+v", models)
	}
}
