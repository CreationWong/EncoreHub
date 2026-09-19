// Group-chat orchestration for multi-AI conversations.
//
// A group conversation stores an ordered roster of characters. One user
// message is routed to selected members: explicit @mentions win, otherwise the
// conversation's reply mode decides. Replies stream sequentially inside one SSE
// response, each segmented by participant_id, and commit in a single Engine
// turn finalization so the transcript keeps its speaking order.
//
// This file intentionally reuses the single-character prompt composition
// (buildChatRequest) per member instead of duplicating it: each member gets its
// own frozen character snapshot, provider, model, and API key, while Skills,
// Knowledge, and per-character memory are resolved exactly like single chat.
//
// Group replies do not run Gateway tool rounds yet. Requests are built with
// tools disabled, so a member answers from the transcript without calling
// web_search, web_fetch, or the memory tools.

package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"com.0d000721.encorehub/gateway/internal/engine"
	"com.0d000721.encorehub/gateway/internal/provider"
)

// groupNoReplySentinel lets a smart-mode member skip its turn without an extra
// decision request. The instruction demands exactly this token and nothing
// else; matching is trimmed and case-insensitive for robustness.
const groupNoReplySentinel = "[[NO_REPLY]]"

// groupSmartModePrompt is appended to a member's system prompt only in smart
// mode. It must stay a pure content instruction: it cannot grant tools.
const groupSmartModePrompt = "You are one member of a multi-AI group conversation. Other members' replies appear as assistant messages. " +
	"Decide whether the latest user message needs your specific contribution. " +
	"If it does not, reply with exactly [[NO_REPLY]] and nothing else. " +
	"If it does, answer in your own voice without repeating what other members already covered."

// groupContextPrompt explains the multi-speaker transcript to every member so
// members do not mistake another bot's assistant message for their own.
const groupContextPrompt = "You are participating in a group conversation with several AI members, each with their own persona. " +
	"Assistant messages may have been written by other members; the user message is the only instruction you must answer. " +
	"Stay in character, keep your reply focused on your own role, and do not speak for the other members."

// GroupChatRequest is the group counterpart of SendMessageRequest.
//
// Mentions carries the participant character ids the user explicitly addressed
// from the composer. When it is empty the Gateway falls back to matching
// "@<member name>" inside the content against the roster.
type GroupChatRequest struct {
	SendMessageRequest
	Mentions []string `json:"mentions"`
}

// groupResponder pairs one roster member with its resolved adapter and key.
type groupResponder struct {
	participant engine.ConversationParticipant
	adapter     provider.Adapter
	apiKey      string
	mock        bool
}

// groupReply accumulates one member's streamed answer before finalization.
type groupReply struct {
	participant   engine.ConversationParticipant
	content       string
	reasoning     string
	finishReason  string
	duration      time.Duration
	usage         provider.UsageEvent
	usageReported bool
}

// GroupChat streams one sequential multi-member reply round for a conversation.
func (h *ChatHandler) GroupChat(c *gin.Context) {
	convID := c.Param("id")
	var req GroupChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := validateChatRequest(req.SendMessageRequest); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if !req.Stream {
		c.JSON(http.StatusBadRequest, gin.H{"error": "group chat requires stream: true"})
		return
	}

	// Group turns can be as long as several provider calls; keep the shared
	// five-minute budget used by single chat.
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Minute)
	defer cancel()

	convDetail, err := h.engine.GetConversation(ctx, convID)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed to load conversation"})
		return
	}
	if len(convDetail.Participants) < 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "conversation is not a group"})
		return
	}

	selected, err := selectGroupParticipants(convDetail, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	responders, err := h.resolveGroupResponders(ctx, c, selected)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	// Knowledge is shared by every member; memory is resolved per member below.
	var knowledgeContext string
	if hits, err := h.engine.SearchKnowledge(ctx, req.Content, 3); err == nil && len(hits) > 0 {
		knowledgeContext = "\n\n[Knowledge Base]\n"
		for i, k := range hits {
			knowledgeContext += fmt.Sprintf("%d. (chunk %d, score %.2f) %s\n", i+1, k.ChunkIndex, k.Score, k.Content)
		}
	}

	autoTitle := shouldGenerateAutomaticTitle(convDetail, req.SendMessageRequest)
	userMessage, err := h.engine.BeginTurnWithAttachments(ctx, convID, req.Content, "", nil)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed to persist chat turn"})
		return
	}

	h.groupStream(ctx, c, convDetail, responders, knowledgeContext, *userMessage, autoTitle)
}

// selectGroupParticipants decides who answers this turn.
//
// Explicit mentions override the reply mode. Name matching is used only when
// the composer did not send ids, so a renamed display name cannot silently
// change routing for the explicit case.
func selectGroupParticipants(conv *engine.ConversationDetail, req GroupChatRequest) ([]engine.ConversationParticipant, error) {
	mentioned := make(map[string]struct{})
	for _, id := range req.Mentions {
		if trimmed := strings.TrimSpace(id); trimmed != "" {
			mentioned[trimmed] = struct{}{}
		}
	}
	if len(mentioned) == 0 {
		mentioned = mentionIDsFromContent(conv.Participants, req.Content)
	}

	selected := make([]engine.ConversationParticipant, 0, len(conv.Participants))
	for _, participant := range conv.Participants {
		if len(mentioned) == 0 {
			selected = append(selected, participant)
			continue
		}
		if _, ok := mentioned[participant.CharacterID]; ok {
			selected = append(selected, participant)
		}
	}
	if len(selected) == 0 {
		return nil, fmt.Errorf("no group member matches the mentioned names")
	}
	sort.SliceStable(selected, func(i, j int) bool {
		return selected[i].Position < selected[j].Position
	})
	return selected, nil
}

// mentionIDsFromContent matches "@<name>" for every roster name. Longer names
// are checked first so "@审题拆解 bot" cannot shadow "@审题拆解".
func mentionIDsFromContent(participants []engine.ConversationParticipant, content string) map[string]struct{} {
	type named struct {
		id   string
		name string
	}
	names := make([]named, 0, len(participants))
	for _, participant := range participants {
		if name := strings.TrimSpace(participant.CharacterSnapshot.Name); name != "" {
			names = append(names, named{id: participant.CharacterID, name: name})
		}
	}
	sort.SliceStable(names, func(i, j int) bool {
		return len([]rune(names[i].name)) > len([]rune(names[j].name))
	})
	matched := make(map[string]struct{})
	for _, entry := range names {
		if strings.Contains(content, "@"+entry.name) {
			matched[entry.id] = struct{}{}
		}
	}
	return matched
}

// resolveGroupResponders resolves each member's provider adapter and API key.
// A missing key fails the whole request before any turn is created, matching
// single-chat behavior; keys are never logged.
func (h *ChatHandler) resolveGroupResponders(ctx context.Context, c *gin.Context, participants []engine.ConversationParticipant) ([]groupResponder, error) {
	responders := make([]groupResponder, 0, len(participants))
	for _, participant := range participants {
		apiKey := c.GetHeader("X-" + participant.Provider + "-Key")
		if apiKey == "" {
			if k, found, err := h.engine.GetSecret(ctx, participant.Provider); err == nil && found {
				apiKey = k
			}
		}
		responder := groupResponder{participant: participant, apiKey: apiKey}
		if apiKey == "" {
			if !devMockEnabled() {
				return nil, fmt.Errorf("missing API key for group member %q (%s)", participant.CharacterSnapshot.Name, participant.Provider)
			}
			responder.mock = true
			responders = append(responders, responder)
			continue
		}
		adapter, err := h.registry.Get(participant.Provider)
		if err != nil {
			return nil, err
		}
		responder.adapter = adapter
		responders = append(responders, responder)
	}
	return responders, nil
}

// groupStream writes the participant-segmented SSE stream and finalizes the
// turn once every selected member has finished.
func (h *ChatHandler) groupStream(ctx context.Context, c *gin.Context, conv *engine.ConversationDetail,
	responders []groupResponder, knowledgeContext string, userMessage engine.Message, autoTitle bool) {

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Status(http.StatusOK)
	flusher, _ := c.Writer.(http.Flusher)

	writeFrame := func(event string, payload any) {
		data, err := json.Marshal(payload)
		if err != nil {
			return
		}
		fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", event, data)
		if flusher != nil {
			flusher.Flush()
		}
	}
	writeFrame("turn_started", map[string]engine.Message{"user_message": userMessage})

	// History grows as members answer so later members can see earlier replies
	// from the same turn.
	history := append([]engine.Message(nil), conv.Messages...)
	history = append(history, userMessage)
	assistants := make([]engine.FinalizeAssistant, 0, len(responders))
	var totalUsage provider.UsageEvent

	for _, responder := range responders {
		reply, ok := h.streamGroupReply(ctx, c, conv, responder, knowledgeContext, userMessage.Content, history, writeFrame)
		if !ok {
			continue
		}
		totalUsage.InputTokens += reply.usage.InputTokens
		totalUsage.OutputTokens += reply.usage.OutputTokens
		totalUsage.CacheCreationInputTokens += reply.usage.CacheCreationInputTokens
		totalUsage.CacheReadInputTokens += reply.usage.CacheReadInputTokens

		metrics := measuredAssistantMetrics(
			reply.usage,
			reply.usageReported,
			reply.usage,
			reply.usageReported,
			reply.duration,
			reply.finishReason,
		)
		assistant := assistantForTurn(reply.content, reply.reasoning, nil, metrics)
		if assistant == nil {
			continue
		}
		assistant.SenderCharacterID = responder.participant.CharacterID
		assistants = append(assistants, *assistant)
		history = append(history, engine.Message{
			Role:              "assistant",
			Content:           reply.content,
			Reasoning:         reply.reasoning,
			SenderCharacterID: &responder.participant.CharacterID,
		})
	}

	status := "completed"
	if len(assistants) == 0 {
		status = "failed"
	}
	finalized, err := h.finalizeGroupTurn(ctx, conv.ID, userMessage.ID, status, assistants)
	if err != nil {
		finalized = h.markTurnFailedBestEffort(ctx, conv.ID, userMessage.ID)
		writeFrame("error", newGroupErrorPayload("persistence_error", "Failed to persist group replies", finalized))
		return
	}

	if autoTitle {
		requestID := c.GetString("request_id")
		first := responders[0].participant
		go func() {
			titleCtx := withLogRequestID(context.WithoutCancel(ctx), requestID)
			h.generateTitle(titleCtx, conv.ID, first.Provider, first.Model, responders[0].apiKey)
		}()
	}

	writeFrame("done", map[string]any{
		"user_message":       finalized.UserMessage,
		"assistant_messages": finalized.AssistantMessages,
		"usage":              totalUsage,
	})
}

// streamGroupReply runs one member's provider call, emitting participant frames.
// It returns ok=false when the member failed, skipped, or produced nothing.
func (h *ChatHandler) streamGroupReply(ctx context.Context, c *gin.Context, conv *engine.ConversationDetail,
	responder groupResponder, knowledgeContext, userContent string, history []engine.Message,
	writeFrame func(string, any)) (groupReply, bool) {

	participant := responder.participant
	reply := groupReply{participant: participant}
	participantID := participant.CharacterID

	// Memory resolution mirrors single chat but is scoped to this member.
	memoryContext := ""
	if resolved, err := h.engine.ResolveConversationMemoryMode(ctx, conv.ID, participantID); err == nil {
		if resolved.Mode == "rag" || resolved.Mode == "rag_enhanced" {
			if hits, searchErr := h.engine.SearchMemoriesForCharacter(ctx, userContent, participantID, 3); searchErr == nil && len(hits) > 0 {
				memoryContext = "\n\n[Relevant Memories]\n"
				for i, memory := range hits {
					memoryContext += fmt.Sprintf("%d. [%s] %s\n", i+1, memory.Scope, memory.Content)
				}
			}
		}
	}

	writeFrame("participant_started", map[string]any{
		"participant_id": participantID,
		"name":           participant.CharacterSnapshot.Name,
		"avatar":         participant.CharacterSnapshot.Avatar,
		"provider":       participant.Provider,
		"model":          participant.Model,
		"position":       participant.Position,
	})

	if responder.mock {
		content := fmt.Sprintf("[Mock] %s: %s", participant.CharacterSnapshot.Name, userContent)
		writeFrame("delta", map[string]any{"content": content, "participant_id": participantID})
		reply.content = content
		writeFrame("participant_done", map[string]any{
			"participant_id": participantID,
			"content":        content,
			"reasoning":      "",
		})
		return reply, true
	}

	// Build the member request against a synthetic conversation view: its own
	// snapshot plus the growing multi-speaker history. Content is cleared so
	// buildChatRequest does not append the user message twice (the persisted
	// turn is already the last history entry).
	builderConv := *conv
	builderConv.CharacterSnapshot = participant.CharacterSnapshot
	builderConv.Messages = history
	memberReq := SendMessageRequest{
		Provider: participant.Provider,
		Model:    participant.Model,
		Stream:   false,
	}
	chatReq := buildChatRequest(&builderConv, memberReq, promptContext{
		Memory:    memoryContext,
		Knowledge: knowledgeContext,
	}, nil, nil)
	// Group v1 answers from the transcript only: no Gateway tool rounds.
	chatReq.Tools = nil
	chatReq.Stream = true
	chatReq.SystemPrompt = strings.TrimSpace(chatReq.SystemPrompt + "\n\n" + groupContextPrompt)
	if conv.ReplyMode == "smart" {
		chatReq.SystemPrompt = strings.TrimSpace(chatReq.SystemPrompt + "\n\n" + groupSmartModePrompt)
	}

	events, err := responder.adapter.ChatStream(ctx, chatReq, responder.apiKey)
	if err != nil {
		writeFrame("participant_error", map[string]any{
			"participant_id": participantID,
			"message":        "Provider request failed",
		})
		return reply, false
	}

	providerStarted := time.Now()
	for event := range events {
		switch {
		case event.Error != nil:
			reply.duration = time.Since(providerStarted)
			writeFrame("participant_error", map[string]any{
				"participant_id": participantID,
				"message":        "Provider stream failed",
			})
			return reply, false
		case event.Reasoning != nil:
			if chatReq.DisableReasoning {
				continue
			}
			reply.reasoning += event.Reasoning.Content
			writeFrame("reasoning", map[string]any{
				"content":        event.Reasoning.Content,
				"participant_id": participantID,
			})
		case event.Delta != nil:
			reply.content += event.Delta.Content
			if event.Delta.FinishReason != "" {
				reply.finishReason = event.Delta.FinishReason
			}
			writeFrame("delta", map[string]any{
				"content":        event.Delta.Content,
				"participant_id": participantID,
			})
		case event.Usage != nil:
			reply.usage = *event.Usage
			reply.usageReported = true
			writeFrame("usage", map[string]any{
				"input_tokens":   event.Usage.InputTokens,
				"output_tokens":  event.Usage.OutputTokens,
				"participant_id": participantID,
			})
		case event.ToolCall != nil:
			// Tools are disabled for group v1; ignore stray protocol frames.
			continue
		}
	}
	reply.duration = time.Since(providerStarted)

	// Smart mode: a member may decline to speak with the sentinel. The reply is
	// not persisted and the turn continues with the next member.
	if conv.ReplyMode == "smart" && strings.EqualFold(strings.TrimSpace(reply.content), groupNoReplySentinel) {
		writeFrame("participant_skipped", map[string]any{"participant_id": participantID})
		return reply, false
	}

	if strings.TrimSpace(reply.content) == "" && strings.TrimSpace(reply.reasoning) == "" {
		writeFrame("participant_error", map[string]any{
			"participant_id": participantID,
			"message":        "Provider returned an empty reply",
		})
		return reply, false
	}

	writeFrame("participant_done", map[string]any{
		"participant_id": participantID,
		"content":        reply.content,
		"reasoning":      reply.reasoning,
	})
	return reply, true
}

// finalizeGroupTurn commits the user turn with every member reply atomically.
func (h *ChatHandler) finalizeGroupTurn(ctx context.Context, convID, turnID, status string,
	assistants []engine.FinalizeAssistant) (*engine.FinalizeTurnResponse, error) {
	finalizeCtx, cancel := boundedTurnContext(ctx, false)
	defer cancel()
	return h.engine.FinalizeTurn(finalizeCtx, convID, turnID, engine.FinalizeTurnRequest{
		Status:     status,
		Assistants: assistants,
	})
}

// newGroupErrorPayload mirrors the single-chat error payload with all
// authoritative assistant messages already committed for the turn.
func newGroupErrorPayload(code, message string, finalized *engine.FinalizeTurnResponse) map[string]any {
	payload := map[string]any{"code": code, "message": message}
	if finalized != nil {
		payload["user_message"] = finalized.UserMessage
		payload["assistant_messages"] = finalized.AssistantMessages
	}
	return payload
}
