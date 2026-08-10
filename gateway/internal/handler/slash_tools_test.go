package handler

import "testing"

func TestParseSlashToolRequest(t *testing.T) {
	tests := []struct {
		content   string
		name      string
		arguments string
	}{
		{content: "  /web_search 搜索2026消息  ", name: "web_search", arguments: "搜索2026消息"},
		{content: " /WEB_FETCH https://example.com/article ", name: "web_fetch", arguments: "https://example.com/article"},
	}
	for _, test := range tests {
		request, err := parseSlashToolRequest(test.content)
		if err != nil {
			t.Fatalf("parse %s request: %v", test.name, err)
		}
		if request == nil || request.definition.name != test.name || request.arguments != test.arguments {
			t.Fatalf("unexpected %s request: %+v", test.name, request)
		}
	}
}

func TestParseSlashToolRequestRejectsMissingArguments(t *testing.T) {
	for _, command := range []string{"/web_search", "/web_fetch"} {
		if _, err := parseSlashToolRequest(command); err == nil {
			t.Fatalf("missing arguments for %s should be rejected", command)
		}
	}
}

func TestParseSlashToolRequestIgnoresUnregisteredCommands(t *testing.T) {
	request, err := parseSlashToolRequest("/settings")
	if err != nil || request != nil {
		t.Fatalf("application shortcut must not become a Slash tool: request=%+v err=%v", request, err)
	}
}
