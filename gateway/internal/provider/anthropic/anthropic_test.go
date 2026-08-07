package anthropic

import (
	"encoding/json"
	"strings"
	"testing"

	// Internal packages use EncoreHub's stable reverse-domain namespace.
	"com.0d000721.encorehub/gateway/internal/provider"
)

func TestNewFromProfileCompletesDomainOnlyGatewayEndpoint(t *testing.T) {
	adapter := NewFromProfile(provider.ProviderProfile{
		ID:      "gateway",
		BaseURL: "https://gateway.example.com/api/anthropic",
	})

	if adapter.baseURL != "https://gateway.example.com/api/anthropic/v1" {
		t.Fatalf("base URL = %q", adapter.baseURL)
	}
}

func TestDecodeStreamLine_ThinkingDelta(t *testing.T) {
	line := `data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"let me think"}}`
	out := decodeStreamLine(line)
	if len(out) != 1 || out[0].Reasoning == nil {
		t.Fatalf("expected reasoning event, got %#v", out)
	}
	if out[0].Reasoning.Content != "let me think" {
		t.Fatalf("reasoning = %q", out[0].Reasoning.Content)
	}
}

func TestDecodeStreamLine_ToolUseStartAndArgs(t *testing.T) {
	start := `data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tu_1","name":"get_weather"}}`
	out := decodeStreamLine(start)
	if len(out) != 1 || out[0].ToolCall == nil {
		t.Fatalf("expected tool_call event, got %#v", out)
	}
	if out[0].ToolCall.ID != "tu_1" || out[0].ToolCall.Name != "get_weather" || out[0].ToolCall.Index != 1 {
		t.Fatalf("tool_call = %#v", out[0].ToolCall)
	}

	args := `data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"city\""}}`
	out = decodeStreamLine(args)
	if len(out) != 1 || out[0].ToolCall == nil {
		t.Fatalf("expected tool_call args event, got %#v", out)
	}
	if out[0].ToolCall.Arguments != `{"city"` || out[0].ToolCall.Index != 1 {
		t.Fatalf("tool_call args = %#v", out[0].ToolCall)
	}
}

func TestDecodeStreamLine_TextDelta(t *testing.T) {
	line := `data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}`
	out := decodeStreamLine(line)
	if len(out) != 1 || out[0].Delta == nil {
		t.Fatalf("expected 1 delta, got %#v", out)
	}
	if out[0].Delta.Content != "Hello" {
		t.Fatalf("expected Hello, got %q", out[0].Delta.Content)
	}
}

func TestDecodeStreamLine_ContentBlockStopDoesNotEmitEmptyToolCall(t *testing.T) {
	// Block boundaries carry no tool identity or arguments and must stay internal.
	line := `data: {"type":"content_block_stop","index":1}`
	if out := decodeStreamLine(line); out != nil {
		t.Fatalf("unexpected events = %#v", out)
	}
}

func TestDecodeStreamLine_MessageDeltaUsage(t *testing.T) {
	line := `data: {"type":"message_delta","usage":{"input_tokens":12,"output_tokens":34}}`
	out := decodeStreamLine(line)
	if len(out) != 1 || out[0].Usage == nil {
		t.Fatalf("expected 1 usage, got %#v", out)
	}
	if out[0].Usage.InputTokens != 12 || out[0].Usage.OutputTokens != 34 {
		t.Fatalf("usage = %#v", out[0].Usage)
	}
}

func TestDecodeStreamLine_MessageStartIncludesCachedPromptUsage(t *testing.T) {
	line := `data: {"type":"message_start","message":{"usage":{"input_tokens":12,"output_tokens":0,"cache_creation_input_tokens":5,"cache_read_input_tokens":20}}}`
	out := decodeStreamLine(line)
	if len(out) != 1 || out[0].Usage == nil {
		t.Fatalf("expected prompt usage, got %#v", out)
	}
	if out[0].Usage.InputTokens != 37 || out[0].Usage.CacheCreationInputTokens != 5 ||
		out[0].Usage.CacheReadInputTokens != 20 {
		t.Fatalf("cached prompt usage = %#v", out[0].Usage)
	}
}

func TestDecodeStreamLine_MessageStop(t *testing.T) {
	line := `data: {"type":"message_stop"}`
	out := decodeStreamLine(line)
	if len(out) != 1 || out[0].Delta == nil {
		t.Fatalf("expected stop delta, got %#v", out)
	}
	if out[0].Delta.FinishReason != "stop" {
		t.Fatalf("finish_reason = %q", out[0].Delta.FinishReason)
	}
}

func TestDecodeStreamLine_Error(t *testing.T) {
	line := `data: {"type":"error","error":{"type":"overloaded","message":"x"}}`
	out := decodeStreamLine(line)
	if len(out) != 1 || out[0].Error == nil {
		t.Fatalf("expected error event, got %#v", out)
	}
	if !strings.Contains(out[0].Error.Error(), "anthropic stream error") {
		t.Fatalf("error msg = %q", out[0].Error.Error())
	}
}

func TestDecodeStreamLine_IgnoresNonDataLines(t *testing.T) {
	cases := []string{
		"",
		":",
		":heartbeat",
		"event: ping",
		`{"type":"content_block_delta"}`, // missing data: prefix
	}
	for _, c := range cases {
		if got := decodeStreamLine(c); got != nil {
			t.Errorf("expected nil for %q, got %#v", c, got)
		}
	}
}

func TestDecodeStreamLine_BadJSONIsSkipped(t *testing.T) {
	if got := decodeStreamLine(`data: not-json`); got != nil {
		t.Fatalf("expected nil for bad json, got %#v", got)
	}
}

func TestDecodeStreamLine_UnknownTypeReturnsNil(t *testing.T) {
	// Protocol bookkeeping without content or usage stays internal.
	line := `data: {"type":"ping"}`
	if got := decodeStreamLine(line); got != nil {
		t.Fatalf("expected nil for ignored type, got %#v", got)
	}
}

func TestBuildRequest_SystemPromptUsedAsTopLevel(t *testing.T) {
	req := &provider.ChatRequest{
		Model:        "claude-sonnet-4-6",
		MaxTokens:    256,
		SystemPrompt: "you are a fixture",
		Messages: []provider.Message{
			{Role: "user", Content: "hi"},
		},
	}
	body := buildRequest(req, true)
	if body.System != "you are a fixture" {
		t.Fatalf("system = %q", body.System)
	}
	if len(body.Messages) != 1 || body.Messages[0].Role != "user" {
		t.Fatalf("messages = %#v", body.Messages)
	}
	if !body.Stream {
		t.Fatalf("stream flag not propagated")
	}
}

func TestBuildRequest_SystemMessageFoldsIntoTopLevel(t *testing.T) {
	// When SystemPrompt is empty AND a role:"system" message appears,
	// it must be hoisted to the top-level System field, not sent as a turn.
	req := &provider.ChatRequest{
		Messages: []provider.Message{
			{Role: "system", Content: "be brief"},
			{Role: "user", Content: "hi"},
		},
	}
	body := buildRequest(req, false)
	if body.System != "be brief" {
		t.Fatalf("expected system folded, got %q", body.System)
	}
	for _, m := range body.Messages {
		if m.Role == "system" {
			t.Fatalf("system message leaked into Messages: %#v", m)
		}
	}
	if len(body.Messages) != 1 {
		t.Fatalf("expected 1 user message, got %d", len(body.Messages))
	}
}

func TestBuildRequest_ExplicitSystemPromptWinsOverSystemMessage(t *testing.T) {
	req := &provider.ChatRequest{
		SystemPrompt: "explicit",
		Messages: []provider.Message{
			{Role: "system", Content: "secondary"},
			{Role: "user", Content: "hi"},
		},
	}
	body := buildRequest(req, false)
	if body.System != "explicit" {
		t.Fatalf("explicit SystemPrompt should win, got %q", body.System)
	}
}

func TestBuildRequest_MapsToolsAndExecutedResultsToAnthropicBlocks(t *testing.T) {
	req := &provider.ChatRequest{
		Tools: []provider.Tool{{
			Type: "function",
			Function: &provider.FunctionDefinition{
				Name: "web_search", Description: "Search the web", Parameters: map[string]any{"type": "object"},
			},
		}},
		Messages: []provider.Message{
			{Role: "assistant", ToolCalls: []provider.ToolCallMessage{{
				ID: "call_0", Name: "web_search", Arguments: `{"query":"nginx"}`,
			}}},
			{Role: "tool", ToolCallID: "call_0", Content: "search result"},
		},
	}

	encoded, err := json.Marshal(buildRequest(req, true))
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	var payload map[string]any
	if err := json.Unmarshal(encoded, &payload); err != nil {
		t.Fatalf("decode request: %v", err)
	}
	tools, _ := payload["tools"].([]any)
	if len(tools) != 1 || tools[0].(map[string]any)["name"] != "web_search" {
		t.Fatalf("tools = %#v", payload["tools"])
	}
	messages := payload["messages"].([]any)
	// Anthropic represents the model call and its result as typed content blocks.
	assistantBlocks := messages[0].(map[string]any)["content"].([]any)
	resultBlocks := messages[1].(map[string]any)["content"].([]any)
	if assistantBlocks[0].(map[string]any)["type"] != "tool_use" ||
		resultBlocks[0].(map[string]any)["type"] != "tool_result" ||
		messages[1].(map[string]any)["role"] != "user" {
		t.Fatalf("messages = %#v", messages)
	}
}

func TestBuildRequest_GroupsParallelToolResultsInOneUserMessage(t *testing.T) {
	req := &provider.ChatRequest{
		Messages: []provider.Message{
			{Role: "assistant", ToolCalls: []provider.ToolCallMessage{
				{ID: "call_0", Name: "web_search", Arguments: `{"query":"first"}`},
				{ID: "call_1", Name: "web_search", Arguments: `{"query":"second"}`},
			}},
			{Role: "tool", ToolCallID: "call_0", Content: "first result"},
			{Role: "tool", ToolCallID: "call_1", Content: "No search results found."},
		},
	}

	body := buildRequest(req, true)
	if len(body.Messages) != 2 {
		t.Fatalf("messages = %#v, want one assistant message followed by one user result message", body.Messages)
	}
	results, ok := body.Messages[1].Content.([]anthropicMessageContent)
	if !ok {
		t.Fatalf("result content type = %T", body.Messages[1].Content)
	}
	if len(results) != 2 || results[0].ToolUseID != "call_0" || results[1].ToolUseID != "call_1" {
		t.Fatalf("tool result blocks = %#v", results)
	}
}

func TestBuildRequest_ExplicitlyDisablesThinking(t *testing.T) {
	body := buildRequest(&provider.ChatRequest{
		Model: "deepseek/deepseek-v4-flash", DisableReasoning: true, ThinkingBudget: 2048,
	}, true)

	// An explicit off switch must take precedence over any stale positive budget.
	if body.Thinking == nil || body.Thinking.Type != "disabled" || body.Thinking.BudgetTokens != 0 {
		t.Fatalf("thinking config = %#v", body.Thinking)
	}
}
