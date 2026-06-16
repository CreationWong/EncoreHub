package handler

import (
	"strings"
	"testing"

	"github.com/encorehub/gateway/internal/engine"
)

func TestBuildChatRequest_AppendsSystemExtra(t *testing.T) {
	conv := &engine.ConversationDetail{
		Messages: []engine.Message{
			{Role: "user", Content: "hi"},
			{Role: "assistant", Content: "hello"},
		},
	}
	req := SendMessageRequest{Model: "x", Temperature: 0.7, Stream: true}

	cr := buildChatRequest(conv, req, "\n\n[Knowledge Base]\n1. (chunk 0) test")

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
	cr := buildChatRequest(conv, SendMessageRequest{}, "")

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
	cr := buildChatRequest(conv, SendMessageRequest{}, "")
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
