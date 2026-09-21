// Background runner for asynchronous multi-AI group conversations.
//
// A group turn is persisted in the Engine queue and processed by one goroutine
// per conversation. Mentions outrank user messages, which outrank voluntary
// bot continuation, so addressing someone always gets an answer first. Each
// reply is appended to the transcript and may itself address another member,
// which keeps the discussion going until the settings' auto-turn limit is
// reached or the user runs /stop.
//
// The runner never reads provider credentials from HTTP headers: background
// work uses the Engine vault, matching the single-chat secret policy.

package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"

	"com.0d000721.encorehub/gateway/internal/engine"
)

const (
	// groupRunnerPollInterval is how often an idle runner re-checks its queue.
	groupRunnerPollInterval = 2 * time.Second
	// groupRunnerIdleTimeout retires a runner with no work for this long.
	groupRunnerIdleTimeout = 5 * time.Minute
	// groupTurnTimeout bounds one queued item's complete generation.
	groupTurnTimeout = 5 * time.Minute
)

// GroupRunnerState reports runner lifecycle for the events stream.
type GroupRunnerState struct {
	State   string `json:"state"`   // idle | running | paused
	Pending int    `json:"pending"` // non-terminal queue items
}

// groupEventHub fans one conversation's runner events out to SSE subscribers.
type groupEventHub struct {
	mu   sync.Mutex
	subs map[string]map[chan []byte]struct{}
}

func newGroupEventHub() *groupEventHub {
	return &groupEventHub{subs: make(map[string]map[chan []byte]struct{})}
}

// Subscribe registers one SSE client. The returned cancel is idempotent.
func (h *groupEventHub) Subscribe(conversationID string) (<-chan []byte, func()) {
	ch := make(chan []byte, 64)
	h.mu.Lock()
	if h.subs[conversationID] == nil {
		h.subs[conversationID] = make(map[chan []byte]struct{})
	}
	h.subs[conversationID][ch] = struct{}{}
	h.mu.Unlock()
	var once sync.Once
	return ch, func() {
		once.Do(func() {
			h.mu.Lock()
			if subscribers, ok := h.subs[conversationID]; ok {
				delete(subscribers, ch)
				if len(subscribers) == 0 {
					delete(h.subs, conversationID)
				}
			}
			h.mu.Unlock()
			close(ch)
		})
	}
}

// Publish writes one SSE frame to every subscriber. A slow subscriber loses
// frames instead of stalling generation.
func (h *groupEventHub) Publish(conversationID, event string, payload any) {
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	frame := []byte(fmt.Sprintf("event: %s\ndata: %s\n\n", event, data))
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs[conversationID] {
		select {
		case ch <- frame:
		default:
		}
	}
}

// GroupRunnerManager owns one background runner per active conversation.
type GroupRunnerManager struct {
	handler *ChatHandler
	hub     *groupEventHub
	mu      sync.Mutex
	runners map[string]*groupRunner
}

// NewGroupRunnerManager creates the manager; the handler is used for provider
// resolution and Engine access, so it must be constructed after the handler.
func NewGroupRunnerManager(handler *ChatHandler) *GroupRunnerManager {
	return &GroupRunnerManager{
		handler: handler,
		hub:     newGroupEventHub(),
		runners: make(map[string]*groupRunner),
	}
}

// Ensure starts the conversation's runner when it is not already alive.
func (m *GroupRunnerManager) Ensure(conversationID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ensureLocked(conversationID)
}

func (m *GroupRunnerManager) ensureLocked(conversationID string) *groupRunner {
	if runner, ok := m.runners[conversationID]; ok {
		return runner
	}
	runner := &groupRunner{
		manager: m,
		handler: m.handler,
		convID:  conversationID,
		wake:    make(chan struct{}, 1),
		state:   "idle",
	}
	m.runners[conversationID] = runner
	go runner.run()
	return runner
}

func (m *GroupRunnerManager) remove(conversationID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.runners, conversationID)
}

// Wake nudges the conversation's runner, starting it when necessary.
func (m *GroupRunnerManager) Wake(conversationID string) {
	m.Ensure(conversationID)
	m.mu.Lock()
	runner := m.runners[conversationID]
	m.mu.Unlock()
	if runner != nil {
		runner.wakeUp()
	}
}

// Cancel aborts the conversation's in-flight generation, if any.
func (m *GroupRunnerManager) Cancel(conversationID string) {
	m.mu.Lock()
	runner := m.runners[conversationID]
	m.mu.Unlock()
	if runner != nil {
		runner.cancelCurrent()
	}
}

// State reports the last published runner state for one conversation.
func (m *GroupRunnerManager) State(conversationID string) GroupRunnerState {
	m.mu.Lock()
	defer m.mu.Unlock()
	if runner, ok := m.runners[conversationID]; ok {
		runner.mu.Lock()
		defer runner.mu.Unlock()
		return GroupRunnerState{State: runner.state, Pending: runner.pending}
	}
	return GroupRunnerState{State: "idle"}
}

// Publish exposes the hub so HTTP handlers can emit queue updates.
func (m *GroupRunnerManager) Publish(conversationID, event string, payload any) {
	m.hub.Publish(conversationID, event, payload)
}

// Subscribe registers one SSE subscriber against the conversation hub.
func (m *GroupRunnerManager) Subscribe(conversationID string) (<-chan []byte, func()) {
	return m.hub.Subscribe(conversationID)
}

// groupRunner is the per-conversation worker.
type groupRunner struct {
	manager *GroupRunnerManager
	handler *ChatHandler
	convID  string
	wake    chan struct{}

	mu              sync.Mutex
	state           string
	pending         int
	consecutiveAuto int
	stopped         bool
	cancel          context.CancelFunc
}

func (r *groupRunner) wakeUp() {
	select {
	case r.wake <- struct{}{}:
	default:
	}
}

// sleep waits for a wake-up, a poll tick, or reports false when retired.
func (r *groupRunner) sleep() bool {
	select {
	case <-r.wake:
		return true
	case <-time.After(groupRunnerPollInterval):
		return true
	}
}

func (r *groupRunner) cancelCurrent() {
	r.mu.Lock()
	cancel := r.cancel
	r.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (r *groupRunner) setCancel(cancel context.CancelFunc) {
	r.mu.Lock()
	r.cancel = cancel
	r.mu.Unlock()
}

func (r *groupRunner) clearCancel() {
	r.mu.Lock()
	r.cancel = nil
	r.mu.Unlock()
}

func (r *groupRunner) isStopped() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.stopped
}

func (r *groupRunner) stateSnapshot() GroupRunnerState {
	r.mu.Lock()
	defer r.mu.Unlock()
	return GroupRunnerState{State: r.state, Pending: r.pending}
}

func (r *groupRunner) setState(state string, pending int) {
	r.mu.Lock()
	r.state = state
	r.pending = pending
	r.mu.Unlock()
	r.manager.Publish(r.convID, "runner_state", GroupRunnerState{State: state, Pending: pending})
}

// run is the runner loop: refresh, claim, generate, repeat until idle.
func (r *groupRunner) run() {
	defer r.manager.remove(r.convID)
	idleSince := time.Now()
	for {
		conversation, err := r.handler.engine.GetConversation(context.Background(), r.convID)
		if err != nil {
			if !r.sleep() {
				return
			}
			continue
		}
		if len(conversation.Participants) < 2 {
			if !r.sleep() {
				return
			}
			continue
		}
		if conversation.GroupSettings.Paused {
			r.setState("paused", r.pendingCount())
			if !r.sleep() {
				return
			}
			continue
		}

		item, err := r.handler.engine.ClaimQueueItem(context.Background(), r.convID)
		if err != nil {
			log.Debug().Err(err).Str("conv_id", r.convID).Msg("group queue claim failed")
			if !r.sleep() {
				return
			}
			continue
		}
		if item == nil {
			r.setState("idle", 0)
			if time.Since(idleSince) > groupRunnerIdleTimeout {
				return
			}
			r.sleep()
			continue
		}

		idleSince = time.Now()
		r.setState("running", r.pendingCount())
		r.process(conversation, *item)
		if r.isStopped() {
			return
		}
	}
}

func (r *groupRunner) pendingCount() int {
	items, err := r.handler.engine.ListQueueItems(context.Background(), r.convID)
	if err != nil {
		return 0
	}
	return len(items)
}

// process handles one claimed item and every follow-up it triggers.
func (r *groupRunner) process(conversation *engine.ConversationDetail, item engine.QueueItem) {
	ctx, cancel := context.WithTimeout(context.Background(), groupTurnTimeout)
	r.setCancel(cancel)
	defer func() {
		r.clearCancel()
		cancel()
	}()

	if item.Source == "user" {
		r.mu.Lock()
		r.consecutiveAuto = 0
		r.mu.Unlock()
	}

	speakers := selectItemSpeakers(conversation, item)
	if len(speakers) == 0 {
		r.completeItem(ctx, item.ID)
		return
	}
	knowledge := r.knowledgeContext(ctx, item.Content)
	history := append([]engine.Message(nil), conversation.Messages...)
	mentionsMade := false

	for index, participant := range speakers {
		if r.isStopped() {
			break
		}
		responder, err := r.responder(ctx, participant)
		if err != nil {
			r.manager.Publish(r.convID, "participant_error", map[string]any{
				"participant_id": participant.CharacterID,
				"message":        "Missing provider API key",
			})
			continue
		}
		reply, ok := r.handler.streamGroupReply(ctx, conversation, responder, knowledge, item.Content, history, func(event string, payload any) {
			r.manager.Publish(r.convID, event, payload)
		})
		if !ok {
			continue
		}
		stored, err := r.persist(ctx, conversation, item, participant, reply)
		if err != nil {
			log.Warn().Err(err).Str("conv_id", r.convID).Msg("group reply persistence failed")
			r.manager.Publish(r.convID, "error", map[string]any{
				"code":    "persistence_error",
				"message": "Failed to persist group reply",
			})
			continue
		}
		r.manager.Publish(r.convID, "message_appended", map[string]any{"message": stored})
		history = append(history, *stored)

		if conversation.GroupSettings.AllowBotMentions {
			targets, _ := parseMentionTargets(conversation.Participants, conversation.GroupSettings.UserPersona.Name, reply.content)
			for _, target := range targets {
				if target.CharacterID == participant.CharacterID {
					continue
				}
				mentionsMade = true
				r.enqueue(ctx, conversation.ID, engine.QueueItem{
					Source:            "mention",
					TargetCharacterID: stringPtr(target.CharacterID),
					SenderCharacterID: stringPtr(participant.CharacterID),
				})
			}
		}

		// Only the last speaker in an item may start an auto chain, so a
		// sequential multi-member answer cannot spawn parallel discussions.
		if index == len(speakers)-1 && !mentionsMade {
			r.enqueueAuto(ctx, conversation, participant)
		}
	}

	r.completeItem(ctx, item.ID)
	r.setState("running", r.pendingCount())
}

// responder resolves one member's adapter and vault key.
func (r *groupRunner) responder(ctx context.Context, participant engine.ConversationParticipant) (groupResponder, error) {
	responders, err := r.handler.resolveGroupResponders(ctx, []engine.ConversationParticipant{participant}, nil)
	if err != nil {
		return groupResponder{}, err
	}
	return responders[0], nil
}

// knowledgeContext runs the shared knowledge lookup for one prompt.
func (r *groupRunner) knowledgeContext(ctx context.Context, query string) string {
	if strings.TrimSpace(query) == "" {
		return ""
	}
	hits, err := r.handler.engine.SearchKnowledge(ctx, query, 3)
	if err != nil || len(hits) == 0 {
		return ""
	}
	var builder strings.Builder
	builder.WriteString("\n\n[Knowledge Base]\n")
	for index, hit := range hits {
		builder.WriteString(fmt.Sprintf("%d. (chunk %d, score %.2f) %s\n", index+1, hit.ChunkIndex, hit.Score, hit.Content))
	}
	return builder.String()
}

// persist appends one generated reply to the transcript.
func (r *groupRunner) persist(ctx context.Context, conversation *engine.ConversationDetail,
	item engine.QueueItem, participant engine.ConversationParticipant, reply groupReply) (*engine.Message, error) {

	parentID := ""
	if len(conversation.Messages) > 0 {
		parentID = conversation.Messages[len(conversation.Messages)-1].ID
	}
	tokenCount := reply.usage.InputTokens + reply.usage.OutputTokens
	request := engine.AppendMessageRequest{
		Content:           reply.content,
		Role:              "assistant",
		ParentID:          parentID,
		SenderCharacterID: participant.CharacterID,
		Reasoning:         reply.reasoning,
		TokenCount:        tokenCount,
		InputTokens:       intPtr(reply.usage.InputTokens),
		OutputTokens:      intPtr(reply.usage.OutputTokens),
		DurationMS:        int64Ptr(reply.duration.Milliseconds()),
	}
	if reply.finishReason != "" {
		request.FinishReason = &reply.finishReason
	}
	return r.handler.engine.AppendMessageFull(ctx, conversation.ID, request)
}

// enqueue appends one follow-up item and wakes the runner.
func (r *groupRunner) enqueue(ctx context.Context, conversationID string, item engine.QueueItem) {
	item.ConversationID = conversationID
	if _, err := r.handler.engine.EnqueueQueueItem(ctx, conversationID, item); err != nil {
		log.Debug().Err(err).Str("conv_id", conversationID).Msg("group queue enqueue failed")
		return
	}
	r.manager.Publish(conversationID, "queue_updated", map[string]any{"pending": r.pendingCount()})
	r.manager.Wake(conversationID)
}

// enqueueAuto continues a bot-to-bot chain when settings allow it.
func (r *groupRunner) enqueueAuto(ctx context.Context, conversation *engine.ConversationDetail, speaker engine.ConversationParticipant) {
	if !conversation.GroupSettings.AutoChatEnabled {
		return
	}
	r.mu.Lock()
	limit := conversation.GroupSettings.MaxAutoTurns
	overLimit := limit != nil && r.consecutiveAuto >= int(*limit)
	r.mu.Unlock()
	if overLimit {
		return
	}
	next := nextParticipant(conversation.Participants, speaker.CharacterID)
	if next == nil {
		return
	}
	r.mu.Lock()
	r.consecutiveAuto++
	r.mu.Unlock()
	r.enqueue(ctx, conversation.ID, engine.QueueItem{
		Source:            "auto",
		TargetCharacterID: stringPtr(next.CharacterID),
		SenderCharacterID: stringPtr(speaker.CharacterID),
	})
}

func (r *groupRunner) completeItem(ctx context.Context, itemID string) {
	if err := r.handler.engine.CompleteQueueItem(ctx, r.convID, itemID); err != nil {
		log.Debug().Err(err).Str("conv_id", r.convID).Msg("group queue completion failed")
	}
}

// selectItemSpeakers maps one queue item to the members that answer it.
func selectItemSpeakers(conversation *engine.ConversationDetail, item engine.QueueItem) []engine.ConversationParticipant {
	switch item.Source {
	case "mention":
		if item.TargetCharacterID == nil {
			return nil
		}
		for _, participant := range conversation.Participants {
			if participant.CharacterID == *item.TargetCharacterID {
				return []engine.ConversationParticipant{participant}
			}
		}
		return nil
	case "auto":
		if item.TargetCharacterID != nil {
			for _, participant := range conversation.Participants {
				if participant.CharacterID == *item.TargetCharacterID {
					return []engine.ConversationParticipant{participant}
				}
			}
			return nil
		}
		if next := nextParticipant(conversation.Participants, lastAssistantSender(conversation.Messages)); next != nil {
			return []engine.ConversationParticipant{*next}
		}
		return nil
	default:
		// A user message: explicit mentions win, otherwise the whole roster
		// answers in order (smart members may still decline).
		if mentioned, _ := parseMentionTargets(conversation.Participants, conversation.GroupSettings.UserPersona.Name, item.Content); len(mentioned) > 0 {
			return mentioned
		}
		return conversation.Participants
	}
}

// nextParticipant returns the member after speakerID, wrapping around.
func nextParticipant(participants []engine.ConversationParticipant, speakerID string) *engine.ConversationParticipant {
	if len(participants) == 0 {
		return nil
	}
	index := -1
	for position, participant := range participants {
		if participant.CharacterID == speakerID {
			index = position
			break
		}
	}
	if index < 0 {
		return &participants[0]
	}
	next := (index + 1) % len(participants)
	return &participants[next]
}

// lastAssistantSender returns the senders of the newest assistant messages.
func lastAssistantSender(messages []engine.Message) string {
	for index := len(messages) - 1; index >= 0; index-- {
		if messages[index].Role == "assistant" && messages[index].SenderCharacterID != nil {
			return *messages[index].SenderCharacterID
		}
	}
	return ""
}

func stringPtr(value string) *string { return &value }
func intPtr(value int) *int          { return &value }
func int64Ptr(value int64) *int64    { return &value }

// GroupEvents streams live runner events for one conversation as SSE.
//
// Opening the stream also ensures the runner exists, so pending queue items
// resume when a client starts watching a group again.
func (h *ChatHandler) GroupEvents(c *gin.Context) {
	conversationID := c.Param("id")
	if _, err := h.engine.GetConversation(c.Request.Context(), conversationID); err != nil {
		c.JSON(404, gin.H{"error": "conversation not found"})
		return
	}

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

	h.groupRunner.Ensure(conversationID)
	h.groupRunner.Wake(conversationID)
	frames, unsubscribe := h.groupRunner.Subscribe(conversationID)
	defer unsubscribe()

	writeFrame("runner_state", h.groupRunner.State(conversationID))
	for {
		select {
		case frame, ok := <-frames:
			if !ok {
				return
			}
			if _, err := c.Writer.Write(frame); err != nil {
				return
			}
			if flusher != nil {
				flusher.Flush()
			}
		case <-c.Request.Context().Done():
			return
		}
	}
}

// GroupMessageRequest is the async group input contract.
//
// Mentions may be sent explicitly by the composer; when absent the Gateway
// falls back to matching "@<member name>" inside the content.
type GroupMessageRequest struct {
	Content  string   `json:"content"`
	Mentions []string `json:"mentions"`
}

// GroupEnqueue persists a user group message and queues its answers.
//
// Commands are accepted from user content only; AI replies never travel
// through this handler, so a bot can never execute a command.
func (h *ChatHandler) GroupEnqueue(c *gin.Context) {
	convID := c.Param("id")
	var req GroupMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	content := strings.TrimSpace(req.Content)
	if content == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "message content required"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	conversation, err := h.engine.GetConversation(ctx, convID)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed to load conversation"})
		return
	}
	if len(conversation.Participants) < 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "conversation is not a group"})
		return
	}

	if strings.HasPrefix(content, "/") {
		command, err := h.executeGroupCommand(ctx, conversation, content)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusAccepted, gin.H{"command": command})
		return
	}

	userMessage, err := h.engine.AppendMessageFull(ctx, convID, engine.AppendMessageRequest{
		Content: content,
		Role:    "user",
	})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed to persist message"})
		return
	}
	h.groupRunner.Publish(convID, "message_appended", map[string]any{"message": userMessage})

	queued := 0
	mentioned := explicitMentionedMembers(conversation, req.Mentions)
	if len(mentioned) == 0 {
		if parsed, _ := parseMentionTargets(conversation.Participants, conversation.GroupSettings.UserPersona.Name, content); len(parsed) > 0 {
			mentioned = parsed
		}
	}
	if len(mentioned) == 0 {
		item := engine.QueueItem{Source: "user", Content: content}
		if err := h.enqueueGroupItem(ctx, convID, item); err != nil {
			// Never report a queued message the runner cannot see: a missing
			// queue surfaces as a Gateway error instead of silence.
			log.Warn().Err(err).Str("conv_id", convID).Msg("group enqueue failed")
			c.JSON(http.StatusBadGateway, gin.H{"error": "failed to queue message"})
			return
		}
		queued = 1
	} else {
		for _, participant := range mentioned {
			item := engine.QueueItem{
				Source:            "mention",
				Content:           content,
				TargetCharacterID: stringPtr(participant.CharacterID),
			}
			if err := h.enqueueGroupItem(ctx, convID, item); err != nil {
				log.Warn().Err(err).Str("conv_id", convID).Msg("group enqueue failed")
				c.JSON(http.StatusBadGateway, gin.H{"error": "failed to queue message"})
				return
			}
			queued++
		}
	}

	h.groupRunner.Wake(convID)
	c.JSON(http.StatusAccepted, gin.H{
		"user_message": userMessage,
		"queued":       queued,
	})
}

// explicitMentionedMembers resolves the composer's mention ids in roster order.
func explicitMentionedMembers(conversation *engine.ConversationDetail, mentions []string) []engine.ConversationParticipant {
	if len(mentions) == 0 {
		return nil
	}
	wanted := make(map[string]struct{}, len(mentions))
	for _, id := range mentions {
		if trimmed := strings.TrimSpace(id); trimmed != "" {
			wanted[trimmed] = struct{}{}
		}
	}
	ordered := make([]engine.ConversationParticipant, 0, len(wanted))
	for _, participant := range conversation.Participants {
		if _, ok := wanted[participant.CharacterID]; ok {
			ordered = append(ordered, participant)
		}
	}
	return ordered
}

// enqueueGroupItem persists one queue item and announces the queue change.
func (h *ChatHandler) enqueueGroupItem(ctx context.Context, conversationID string, item engine.QueueItem) error {
	if _, err := h.engine.EnqueueQueueItem(ctx, conversationID, item); err != nil {
		return err
	}
	h.groupRunner.Publish(conversationID, "queue_updated", map[string]any{})
	return nil
}

// executeGroupCommand applies one user-only slash command.
//
// `/stop` aborts generation, clears the queue, and pauses the group; `/pause`
// keeps the queue but stops generating; `/resume` continues.
func (h *ChatHandler) executeGroupCommand(ctx context.Context, conversation *engine.ConversationDetail, content string) (string, error) {
	fields := strings.Fields(strings.TrimPrefix(content, "/"))
	if len(fields) == 0 {
		return "", fmt.Errorf("empty group command")
	}
	command := strings.ToLower(fields[0])
	switch command {
	case "stop":
		h.groupRunner.Cancel(conversation.ID)
		if _, err := h.engine.ClearQueue(ctx, conversation.ID); err != nil {
			return "", err
		}
		if err := h.setGroupPaused(ctx, conversation, true); err != nil {
			return "", err
		}
	case "pause":
		if err := h.setGroupPaused(ctx, conversation, true); err != nil {
			return "", err
		}
	case "resume":
		if err := h.setGroupPaused(ctx, conversation, false); err != nil {
			return "", err
		}
		h.groupRunner.Wake(conversation.ID)
	default:
		return "", fmt.Errorf("unknown group command: /%s", command)
	}

	if _, err := h.engine.AppendMessageFull(ctx, conversation.ID, engine.AppendMessageRequest{
		Content: "/" + command,
		Role:    "system",
	}); err != nil {
		return "", err
	}
	h.groupRunner.Publish(conversation.ID, "runner_state", h.groupRunner.State(conversation.ID))
	return command, nil
}

// setGroupPaused persists the pause flag on the conversation's settings.
func (h *ChatHandler) setGroupPaused(ctx context.Context, conversation *engine.ConversationDetail, paused bool) error {
	settings := conversation.GroupSettings
	settings.Paused = paused
	_, err := h.engine.UpdateConversation(ctx, conversation.ID, engine.ConversationUpdate{
		GroupSettings: &settings,
	})
	return err
}
