// Rolling conversation summarization.
//
// Generates a model-written summary of the archived part of a conversation and
// persists it through Engine. The client decides when to call this (threshold
// or manual compress); Gateway owns the provider call because Engine never
// talks to AI providers. Summaries roll: a previous summary is folded into the
// new one and the stored range keeps its original start.

package handler

import (
	"context"
	"io"
	"net/http"
	"strings"
	"time"

	// Internal packages use EncoreHub's stable reverse-domain namespace.
	"com.0d000721.encorehub/gateway/internal/engine"
	"com.0d000721.encorehub/gateway/internal/provider"
	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"
)

const (
	// summarizeContextTimeout bounds one hidden summarization request.
	summarizeContextTimeout = 60 * time.Second
	// summarizeMaxOutputTokens keeps the summary bounded regardless of model.
	summarizeMaxOutputTokens = 1024
	// summarizeMessageRunes caps one message's contribution to the prompt.
	summarizeMessageRunes = 2_000
	// summarizeMaxPromptRunes caps the transcript; older turns stay covered by
	// the folded previous summary instead of the prompt.
	summarizeMaxPromptRunes = 60_000
	// summarizeMinMessages avoids summarizing a conversation with no history.
	summarizeMinMessages = 4
	// summarizeDefaultKeepRecent mirrors the chat contract's retained tail.
	summarizeDefaultKeepRecent = 6
	summarizeMinKeepRecent     = 1
	summarizeMaxKeepRecent     = 50
)

// summarizeSystemPrompt instructs the model to compress, not to answer or add.
const summarizeSystemPrompt = `You compress conversation history for an AI assistant. Produce a factual summary of the earlier exchange that preserves decisions, user preferences, constraints, unresolved questions, and facts needed to continue the conversation. Write plain prose without markdown headings. Do not add information that is not present in the transcript, and do not mention that a summary is being made.`

// SummarizeContextRequest is the body of POST /conversations/:id/summarize-context.
type SummarizeContextRequest struct {
	// KeepRecent is the number of newest messages left outside the summary.
	KeepRecent int `json:"keep_recent"`
}

// SummarizeContextResponse returns the stored summary and its message range.
type SummarizeContextResponse struct {
	Summary        string               `json:"summary"`
	StartMessageID string               `json:"start_message_id"`
	EndMessageID   string               `json:"end_message_id"`
	KeepRecent     int                  `json:"keep_recent"`
	Provider       string               `json:"provider"`
	Model          string               `json:"model"`
	Usage          *provider.UsageEvent `json:"usage,omitempty"`
}

// SummarizeContext handles POST /api/v1/conversations/:id/summarize-context.
// The conversation's own provider and model are used; the request never
// switches models silently.
func (h *ChatHandler) SummarizeContext(c *gin.Context) {
	convID := c.Param("id")
	var req SummarizeContextRequest
	if err := c.ShouldBindJSON(&req); err != nil && err != io.EOF {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid summarization request"})
		return
	}

	conv, err := h.engine.GetConversation(c.Request.Context(), convID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "conversation not found"})
		return
	}
	if len(conv.Messages) < summarizeMinMessages {
		c.JSON(http.StatusBadRequest, gin.H{"error": "not enough messages to summarize"})
		return
	}
	keepRecent := req.KeepRecent
	if keepRecent == 0 {
		keepRecent = summarizeDefaultKeepRecent
	}
	if keepRecent < summarizeMinKeepRecent {
		keepRecent = summarizeMinKeepRecent
	}
	if keepRecent > summarizeMaxKeepRecent {
		keepRecent = summarizeMaxKeepRecent
	}
	if keepRecent >= len(conv.Messages) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "not enough archived messages to summarize"})
		return
	}

	providerName := conv.Provider
	model := conv.Model
	if providerName == "" {
		providerName = "openai"
	}
	if model == "" {
		model = "gpt-4o"
	}

	apiKey := c.GetHeader("X-Provider-Key")
	if apiKey == "" {
		apiKey = c.GetHeader("X-" + providerName + "-Key")
	}
	if apiKey == "" {
		if k, found, engineErr := h.engine.GetSecret(c.Request.Context(), providerName); engineErr != nil {
			log.Debug().Err(engineErr).Msg("engine secret lookup failed (non-fatal)")
		} else if found {
			apiKey = k
		}
	}
	if apiKey == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "missing provider API key"})
		return
	}

	adapter, err := h.registry.Get(providerName)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	archived := conv.Messages[:len(conv.Messages)-keepRecent]
	foldStart, startMessageID, previous := summarizationRange(conv, archived)
	// Nothing new since the stored summary: return it without another call.
	if previous != "" && foldStart >= len(archived) {
		c.JSON(http.StatusOK, SummarizeContextResponse{
			Summary:        previous,
			StartMessageID: startMessageID,
			EndMessageID:   archived[len(archived)-1].ID,
			KeepRecent:     keepRecent,
			Provider:       providerName,
			Model:          model,
		})
		return
	}

	requestCtx := withLogRequestID(c.Request.Context(), c.GetString("request_id"))
	ctx, cancel := context.WithTimeout(requestCtx, summarizeContextTimeout)
	defer cancel()

	transcript := formatSummarizationTranscript(archived[foldStart:])
	if previous != "" {
		transcript = "Summary so far:\n" + previous + "\n\nNew exchange to fold in:\n" + transcript
	}
	response, err := adapter.Chat(ctx, &provider.ChatRequest{
		Model:        model,
		SystemPrompt: summarizeSystemPrompt,
		Messages: []provider.Message{
			{Role: "user", Content: transcript},
		},
		MaxTokens:   summarizeMaxOutputTokens,
		Temperature: 0.2,
	}, apiKey)
	if err != nil {
		log.Warn().Err(err).Str("conv_id", convID).Msg("context summarization failed")
		c.JSON(http.StatusBadGateway, gin.H{"error": "summarization failed"})
		return
	}
	summary := strings.TrimSpace(response.Content)
	if summary == "" {
		c.JSON(http.StatusBadGateway, gin.H{"error": "summarization returned no content"})
		return
	}

	if err := h.engine.SaveConversationSummary(ctx, convID, engine.SaveConversationSummaryRequest{
		Summary:        summary,
		StartMessageID: startMessageID,
		EndMessageID:   archived[len(archived)-1].ID,
	}); err != nil {
		log.Error().Err(err).Str("conv_id", convID).Msg("failed to persist conversation summary")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to persist summary"})
		return
	}

	usage := provider.UsageEvent{
		InputTokens:              response.InputTokens,
		OutputTokens:             response.OutputTokens,
		CacheCreationInputTokens: response.CacheCreationInputTokens,
		CacheReadInputTokens:     response.CacheReadInputTokens,
	}
	c.JSON(http.StatusOK, SummarizeContextResponse{
		Summary:        summary,
		StartMessageID: startMessageID,
		EndMessageID:   archived[len(archived)-1].ID,
		KeepRecent:     keepRecent,
		Provider:       providerName,
		Model:          model,
		Usage:          &usage,
	})
}

// summarizationRange resolves what to fold this round. With a stored summary
// that ends inside the archived range, its text is folded in and the original
// start is preserved so the stored range stays an accurate coverage claim.
// It returns the index of the first archived message not yet summarized.
func summarizationRange(conv *engine.ConversationDetail, archived []engine.Message) (int, string, string) {
	startMessageID := archived[0].ID
	if conv.Summary == nil || *conv.Summary == "" || conv.SummaryEndMessageID == nil {
		return 0, startMessageID, ""
	}
	previousEnd := -1
	for index, message := range conv.Messages {
		if message.ID == *conv.SummaryEndMessageID {
			previousEnd = index
			break
		}
	}
	if previousEnd < 0 || previousEnd >= len(archived) {
		return 0, startMessageID, ""
	}
	if conv.SummaryStartMessageID != nil && *conv.SummaryStartMessageID != "" {
		startMessageID = *conv.SummaryStartMessageID
	}
	return previousEnd + 1, startMessageID, *conv.Summary
}

// formatSummarizationTranscript renders archived messages as "User:" /
// "Assistant:" lines, truncating long bodies from the oldest side first so the
// newest archived turns always reach the model.
func formatSummarizationTranscript(messages []engine.Message) string {
	lines := make([]string, 0, len(messages))
	used := 0
	for index := len(messages) - 1; index >= 0; index-- {
		message := messages[index]
		content := truncateRunes(strings.TrimSpace(message.Content), summarizeMessageRunes)
		if content == "" {
			continue
		}
		line := roleLabel(message.Role) + ": " + content
		if used+len([]rune(line)) > summarizeMaxPromptRunes {
			break
		}
		used += len([]rune(line))
		lines = append(lines, line)
	}
	for left, right := 0, len(lines)-1; left < right; left, right = left+1, right-1 {
		lines[left], lines[right] = lines[right], lines[left]
	}
	return strings.Join(lines, "\n\n")
}

// roleLabel maps protocol roles to stable transcript labels.
func roleLabel(role string) string {
	switch role {
	case "assistant":
		return "Assistant"
	case "system":
		return "System"
	case "tool":
		return "Tool"
	default:
		return "User"
	}
}
