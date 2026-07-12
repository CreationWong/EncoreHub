package handler

import (
	"bytes"
	"errors"
	"strings"
	"testing"

	"github.com/encorehub/gateway/internal/provider"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

const logCanary = "WF01-CANARY-private-conversation-content"

func captureHandlerLogs(t *testing.T, emit func()) string {
	t.Helper()
	previous := log.Logger
	var output bytes.Buffer
	log.Logger = zerolog.New(&output).Level(zerolog.DebugLevel)
	t.Cleanup(func() { log.Logger = previous })

	emit()
	return output.String()
}

func assertLogOmitsCanary(t *testing.T, output string) {
	t.Helper()
	if strings.Contains(output, logCanary) {
		t.Fatalf("log leaked private payload: %s", output)
	}
}

func TestToolLoopLogOmitsChatPayload(t *testing.T) {
	req := &provider.ChatRequest{
		Model:        "test-model",
		SystemPrompt: logCanary,
		Messages: []provider.Message{
			{Role: "user", Content: logCanary},
		},
		Tools: []provider.Tool{{Type: "function"}},
	}

	output := captureHandlerLogs(t, func() {
		logToolLoopFollowup(req, 2)
	})

	assertLogOmitsCanary(t, output)
	for _, field := range []string{"\"round\":2", "\"message_count\":1", "\"tool_count\":1"} {
		if !strings.Contains(output, field) {
			t.Fatalf("safe metadata %s missing from log: %s", field, output)
		}
	}
}

func TestExternalErrorLogOmitsErrorBody(t *testing.T) {
	err := errors.New("provider http 429: " + logCanary)
	output := captureHandlerLogs(t, func() {
		safeExternalError(log.Error().Str("request_id", "req-123"), err).
			Msg("provider chat failed")
	})

	assertLogOmitsCanary(t, output)
	for _, field := range []string{
		"\"request_id\":\"req-123\"",
		"\"error_category\":\"upstream_http\"",
		"\"upstream_status\":429",
		"\"error_length\":",
	} {
		if !strings.Contains(output, field) {
			t.Fatalf("safe error metadata %s missing from log: %s", field, output)
		}
	}
}

func TestTitleLogsOmitRequestResponseAndRawContent(t *testing.T) {
	meta := titleLogMetadata{
		ConversationID: "conv-123",
		Provider:       "openai",
		Model:          "test-model",
		Attempt:        2,
	}
	response := &provider.ChatResponse{
		Content:          logCanary,
		ReasoningContent: logCanary,
	}

	output := captureHandlerLogs(t, func() {
		logTitleProviderFailure(meta, errors.New("upstream body: "+logCanary))
		logTitleRejected(meta, response, logCanary)
	})

	assertLogOmitsCanary(t, output)
	for _, field := range []string{
		"\"attempt\":2",
		"\"response_content_length\":",
		"\"response_reasoning_length\":",
		"\"raw_length\":",
	} {
		if !strings.Contains(output, field) {
			t.Fatalf("title metadata %s missing from log: %s", field, output)
		}
	}
}

func TestSearchLogOmitsRawQuery(t *testing.T) {
	output := captureHandlerLogs(t, func() {
		logSearchCompleted("duckduckgo", logCanary, 3)
	})

	assertLogOmitsCanary(t, output)
	if !strings.Contains(output, "\"query_length\":") || !strings.Contains(output, "\"results\":3") {
		t.Fatalf("safe search metadata missing from log: %s", output)
	}
}
