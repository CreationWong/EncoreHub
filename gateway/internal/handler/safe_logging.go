package handler

import (
	"context"
	"errors"
	"fmt"
	"net"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	// Internal packages use EncoreHub's stable reverse-domain namespace.
	"com.0d000721.encorehub/gateway/internal/provider"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

var upstreamHTTPStatusPattern = regexp.MustCompile(`(?i)\bhttp(?:\s+status)?\s+([1-5][0-9]{2})\b`)

type logRequestIDKey struct{}

func withLogRequestID(ctx context.Context, requestID string) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	if requestID == "" {
		return ctx
	}
	return context.WithValue(ctx, logRequestIDKey{}, requestID)
}

func logRequestID(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	requestID, _ := ctx.Value(logRequestIDKey{}).(string)
	return requestID
}

// safeExternalError records diagnostic shape without persisting the error text.
// Provider errors can contain response bodies, prompts, or request URLs.
func safeExternalError(event *zerolog.Event, err error) *zerolog.Event {
	if err == nil {
		return event.Str("error_category", "unknown").Int("error_length", 0)
	}

	event = event.
		Str("error_category", classifyExternalError(err)).
		Str("error_type", fmt.Sprintf("%T", err)).
		Int("error_length", utf8.RuneCountInString(err.Error()))
	if status := upstreamHTTPStatus(err); status != 0 {
		event = event.Int("upstream_status", status)
	}
	return event
}

func classifyExternalError(err error) string {
	switch {
	case errors.Is(err, context.Canceled):
		return "cancelled"
	case errors.Is(err, context.DeadlineExceeded):
		return "timeout"
	}

	var networkError net.Error
	if errors.As(err, &networkError) {
		if networkError.Timeout() {
			return "timeout"
		}
		return "network"
	}
	if upstreamHTTPStatus(err) != 0 {
		return "upstream_http"
	}

	lower := strings.ToLower(err.Error())
	if strings.Contains(lower, "decode") || strings.Contains(lower, "unmarshal") {
		return "decode"
	}
	return "external"
}

func upstreamHTTPStatus(err error) int {
	match := upstreamHTTPStatusPattern.FindStringSubmatch(err.Error())
	if len(match) != 2 {
		return 0
	}
	status, parseErr := strconv.Atoi(match[1])
	if parseErr != nil {
		return 0
	}
	return status
}

func logToolLoopFollowup(req *provider.ChatRequest, round int) {
	messageCount := 0
	toolCount := 0
	hasSystemPrompt := false
	model := ""
	if req != nil {
		messageCount = len(req.Messages)
		toolCount = len(req.Tools)
		hasSystemPrompt = req.SystemPrompt != ""
		model = req.Model
	}
	log.Info().
		Int("round", round).
		Str("model", model).
		Int("message_count", messageCount).
		Int("tool_count", toolCount).
		Bool("has_system_prompt", hasSystemPrompt).
		Msg("tool-loop follow-up request")
}

func logSearchCompleted(providerName, query string, results int) {
	log.Info().
		Str("provider", providerName).
		Int("query_length", utf8.RuneCountInString(query)).
		Int("results", results).
		Msg("web_search tool executed")
}

type titleLogMetadata struct {
	RequestID      string
	ConversationID string
	Provider       string
	Model          string
	Attempt        int
}

func titleLogEvent(event *zerolog.Event, meta titleLogMetadata) *zerolog.Event {
	event = event.
		Str("conv_id", meta.ConversationID).
		Str("provider", meta.Provider).
		Str("model", meta.Model).
		Int("attempt", meta.Attempt)
	if meta.RequestID != "" {
		event = event.Str("request_id", meta.RequestID)
	}
	return event
}

func logTitleProviderFailure(meta titleLogMetadata, err error) {
	safeExternalError(titleLogEvent(log.Error(), meta), err).
		Msg("title generation API call failed")
}

func logTitleRejected(meta titleLogMetadata, response *provider.ChatResponse, raw string) {
	event := titleLogEvent(log.Error(), meta).
		Int("raw_length", utf8.RuneCountInString(raw))
	if response != nil {
		event = event.
			Int("response_content_length", utf8.RuneCountInString(response.Content)).
			Int("response_reasoning_length", utf8.RuneCountInString(response.ReasoningContent))
	} else {
		event = event.
			Int("response_content_length", 0).
			Int("response_reasoning_length", 0)
	}
	event.Msg("title generation returned empty or meta title")
}
