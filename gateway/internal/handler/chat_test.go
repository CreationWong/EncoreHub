package handler

import (
	"strings"
	"testing"

	"github.com/encorehub/gateway/internal/engine"
	"github.com/encorehub/gateway/internal/provider"
)

func TestBuildChatRequest_AppendsSystemExtra(t *testing.T) {
	conv := &engine.ConversationDetail{
		Messages: []engine.Message{
			{Role: "user", Content: "hi"},
			{Role: "assistant", Content: "hello"},
		},
	}
	req := SendMessageRequest{Model: "x", Temperature: 0.7, Stream: true}

	cr := buildChatRequest(conv, req, "\n\n[Knowledge Base]\n1. (chunk 0) test", nil)

	if cr.Model != "x" {
		t.Errorf("model = %q", cr.Model)
	}
	if cr.MaxTokens != 4096 {
		t.Errorf("max_tokens default lost: %d", cr.MaxTokens)
	}
	if !strings.HasPrefix(cr.SystemPrompt, "You are EncoreHub") {
		t.Errorf("base system prompt lost: %q", cr.SystemPrompt)
	}
	if !strings.Contains(cr.SystemPrompt, "[Knowledge Base]") {
		t.Errorf("system extra not appended: %q", cr.SystemPrompt)
	}
	if !cr.Stream || cr.Temperature != 0.7 {
		t.Errorf("stream/temperature not propagated: %+v", cr)
	}
}

func TestBuildChatRequest_PreservesMessageOrder(t *testing.T) {
	conv := &engine.ConversationDetail{
		Messages: []engine.Message{
			{Role: "user", Content: "first"},
			{Role: "assistant", Content: "second"},
			{Role: "user", Content: "third"},
		},
	}
	cr := buildChatRequest(conv, SendMessageRequest{}, "", nil)

	if len(cr.Messages) != 3 {
		t.Fatalf("expected 3 messages, got %d", len(cr.Messages))
	}
	if cr.Messages[0].Content != "first" || cr.Messages[2].Content != "third" {
		t.Errorf("order broken: %#v", cr.Messages)
	}
	if cr.Messages[1].Role != "assistant" {
		t.Errorf("role lost on roundtrip: %s", cr.Messages[1].Role)
	}
}

func TestBuildChatRequest_EmptyHistory(t *testing.T) {
	conv := &engine.ConversationDetail{}
	cr := buildChatRequest(conv, SendMessageRequest{}, "", nil)
	if len(cr.Messages) != 0 {
		t.Errorf("empty history must yield empty Messages, got %d", len(cr.Messages))
	}
}

func TestContainsLower_Cases(t *testing.T) {
	cases := []struct {
		hay  string
		ndl  string
		want bool
	}{
		{"Hello World", "world", true},
		{"HELLO", "hello", true},
		{"Mixed Case", "case", true},
		{"短消息", "消息", true}, // ASCII-only lowercase shouldn't break UTF-8 substrings
		{"abc", "xyz", false},
		{"abc", "abcd", false}, // longer needle fails fast
	}
	for _, c := range cases {
		if got := containsLower(c.hay, c.ndl); got != c.want {
			t.Errorf("containsLower(%q,%q) = %v, want %v", c.hay, c.ndl, got, c.want)
		}
	}
}

func TestGenerateMockReply_TruncatesLongInput(t *testing.T) {
	long := strings.Repeat("x", 250)
	out := generateMockReply(long)
	if !strings.Contains(out, "...") {
		t.Errorf("expected truncation marker in mock reply: %q", out)
	}
}

func TestGenerateMockReply_RoutesByKeyword(t *testing.T) {
	helloOut := generateMockReply("hello")
	if !strings.Contains(strings.ToLower(helloOut), "hello") {
		t.Errorf("hello branch missing: %q", helloOut)
	}
	helpOut := generateMockReply("help")
	if !strings.Contains(strings.ToLower(helpOut), "command") {
		t.Errorf("help branch missing: %q", helpOut)
	}
}

func TestDevMockEnabled_RespectsEnv(t *testing.T) {
	t.Setenv("ENCOREHUB_DEV_MOCK", "")
	if devMockEnabled() {
		t.Error("empty env should be disabled")
	}
	t.Setenv("ENCOREHUB_DEV_MOCK", "1")
	if !devMockEnabled() {
		t.Error("'1' should enable")
	}
	t.Setenv("ENCOREHUB_DEV_MOCK", "true")
	if !devMockEnabled() {
		t.Error("'true' should enable")
	}
	t.Setenv("ENCOREHUB_DEV_MOCK", "yes")
	if devMockEnabled() {
		t.Error("only 1/true accepted; 'yes' must NOT enable")
	}
}

func TestToolCallAggregator_AggregatesFragmentsByIndex(t *testing.T) {
	agg := newToolCallAggregator()
	// Tool call at index 0 streamed across fragments: name first, then args.
	agg.add(&provider.ToolCallEvent{Index: 0, ID: "c1", Name: "search"})
	agg.add(&provider.ToolCallEvent{Index: 0, Arguments: `{"q":`})
	agg.add(&provider.ToolCallEvent{Index: 0, Arguments: `"cats"}`})
	// A second tool call at index 1.
	agg.add(&provider.ToolCallEvent{Index: 1, Name: "calc", Arguments: "1+1"})

	out := agg.toInputs()
	if len(out) != 2 {
		t.Fatalf("expected 2 calls, got %d: %#v", len(out), out)
	}
	if out[0].Name != "search" || out[0].Arguments != `{"q":"cats"}` {
		t.Fatalf("call 0 = %#v", out[0])
	}
	if out[1].Name != "calc" || out[1].Arguments != "1+1" {
		t.Fatalf("call 1 = %#v", out[1])
	}
	// Default status is pending until a result arrives.
	if out[0].Status != "pending" {
		t.Fatalf("status = %q", out[0].Status)
	}
}

func TestToolCallAggregator_SkipsUnnamedCalls(t *testing.T) {
	agg := newToolCallAggregator()
	// Args without a name (e.g. a stray fragment) should not produce a call.
	agg.add(&provider.ToolCallEvent{Index: 5, Arguments: "orphan"})
	if got := agg.toInputs(); len(got) != 0 {
		t.Fatalf("expected no calls, got %#v", got)
	}
}

func TestToolCallAggregator_SetResultFillsPending(t *testing.T) {
	agg := newToolCallAggregator()
	agg.add(&provider.ToolCallEvent{Index: 0, Name: "search", Arguments: "{}"})
	agg.setResult(&provider.ToolResultEvent{Result: "ok", Status: "success"})
	out := agg.toInputs()
	if len(out) != 1 || out[0].Result != "ok" || out[0].Status != "success" {
		t.Fatalf("result not applied: %#v", out)
	}
}
