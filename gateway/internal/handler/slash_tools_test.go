package handler

import "testing"

func TestParseSlashToolRequest(t *testing.T) {
	request, err := parseSlashToolRequest("  /web_search 搜索2026消息  ")
	if err != nil {
		t.Fatalf("parse request: %v", err)
	}
	if request == nil || request.definition.name != "web_search" || request.arguments != "搜索2026消息" {
		t.Fatalf("unexpected request: %+v", request)
	}
}

func TestParseSlashToolRequestRejectsMissingArguments(t *testing.T) {
	if _, err := parseSlashToolRequest("/web_search"); err == nil {
		t.Fatal("missing search query should be rejected")
	}
}

func TestParseSlashToolRequestIgnoresUnregisteredCommands(t *testing.T) {
	request, err := parseSlashToolRequest("/settings")
	if err != nil || request != nil {
		t.Fatalf("application shortcut must not become a Slash tool: request=%+v err=%v", request, err)
	}
}
