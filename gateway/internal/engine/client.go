// Package engine provides an HTTP client for the Rust engine API.
package engine

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// Client communicates with the EncoreHub Rust engine via HTTP.
type Client struct {
	baseURL    string
	httpClient *http.Client
}

// Conversation represents a conversation from the engine.
type Conversation struct {
	ID           string    `json:"id"`
	Title        string    `json:"title"`
	Provider     string    `json:"provider"`
	Model        string    `json:"model"`
	MessageCount int       `json:"message_count"`
	CreatedAt    string    `json:"created_at"`
	UpdatedAt    string    `json:"updated_at"`
}

// ConversationDetail includes messages.
type ConversationDetail struct {
	ID        string              `json:"id"`
	Title     string              `json:"title"`
	Provider  string              `json:"provider"`
	Model     string              `json:"model"`
	Messages  []Message           `json:"messages"`
	Summary   *string             `json:"summary"`
	CreatedAt string              `json:"created_at"`
	UpdatedAt string              `json:"updated_at"`
}

// Message represents a single message.
type Message struct {
	ID        string   `json:"id"`
	Role      string   `json:"role"`
	Content   string   `json:"content"`
	ParentID  *string  `json:"parent_id"`
	CreatedAt string   `json:"created_at"`
}

// SendMessageResponse is the response from sending a message to the engine.
type SendMessageResponse struct {
	UserMessage      Message `json:"user_message"`
	AssistantMessage Message `json:"assistant_message"`
}

// ListResponse is the response from listing conversations.
type ListResponse struct {
	Conversations []Conversation `json:"conversations"`
	Total         int            `json:"total"`
}

// NewClient creates a new engine client.
func NewClient(baseURL string) *Client {
	return &Client{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// CreateConversation creates a new conversation in the engine.
func (c *Client) CreateConversation(ctx context.Context, title, provider, model string) (*Conversation, error) {
	body := map[string]string{
		"title":    title,
		"provider": provider,
		"model":    model,
	}
	var conv Conversation
	if err := c.doJSON(ctx, "POST", "/api/conversations", body, &conv); err != nil {
		return nil, err
	}
	return &conv, nil
}

// GetConversation retrieves a conversation with messages.
func (c *Client) GetConversation(ctx context.Context, id string) (*ConversationDetail, error) {
	var detail ConversationDetail
	if err := c.doJSON(ctx, "GET", "/api/conversations/"+id, nil, &detail); err != nil {
		return nil, err
	}
	return &detail, nil
}

// ListConversations lists all conversations.
func (c *Client) ListConversations(ctx context.Context) (*ListResponse, error) {
	var resp ListResponse
	if err := c.doJSON(ctx, "GET", "/api/conversations", nil, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// SendMessage sends a message and gets the AI response.
func (c *Client) SendMessage(ctx context.Context, convID, content string) (*SendMessageResponse, error) {
	body := map[string]string{"content": content}
	var resp SendMessageResponse
	if err := c.doJSON(ctx, "POST", "/api/conversations/"+convID+"/messages", body, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// Health checks if the engine is reachable.
func (c *Client) Health(ctx context.Context) error {
	return c.doJSON(ctx, "GET", "/health", nil, nil)
}

// BaseURL returns the engine's base URL.
func (c *Client) BaseURL() string {
	return c.baseURL
}

// AppendMessage stores a single message in the engine without auto-reply.
type AppendMessageRequest struct {
	Content  string `json:"content"`
	Role     string `json:"role"`
	ParentID string `json:"parent_id,omitempty"`
}

func (c *Client) AppendMessage(ctx context.Context, convID, content, role, parentID string) (*Message, error) {
	body := AppendMessageRequest{
		Content:  content,
		Role:     role,
		ParentID: parentID,
	}
	var msg Message
	if err := c.doJSON(ctx, "POST", "/api/conversations/"+convID+"/messages/append", body, &msg); err != nil {
		return nil, err
	}
	return &msg, nil
}

// MemoryHit is a single result from memory search.
type MemoryHit struct {
	Content string `json:"content"`
	Scope   string `json:"scope"`
}

type memorySearchResponse struct {
	Results []MemoryHit `json:"results"`
}

// SearchMemories runs FTS memory search via the engine.
func (c *Client) SearchMemories(ctx context.Context, q string, topK int) ([]MemoryHit, error) {
	if q == "" {
		return nil, nil
	}
	if topK <= 0 {
		topK = 3
	}
	path := fmt.Sprintf("/api/memories/search?q=%s&top_k=%d", url.QueryEscape(q), topK)
	var resp memorySearchResponse
	if err := c.doJSON(ctx, "GET", path, nil, &resp); err != nil {
		return nil, err
	}
	return resp.Results, nil
}

// KnowledgeHit is a single chunk match from knowledge search.
type KnowledgeHit struct {
	Content    string  `json:"content"`
	DocumentID string  `json:"document_id"`
	ChunkIndex int     `json:"chunk_index"`
	Score      float64 `json:"score"`
}

type knowledgeSearchResponse struct {
	Results []KnowledgeHit `json:"results"`
}

// SearchKnowledge runs knowledge-base chunk search via the engine.
func (c *Client) SearchKnowledge(ctx context.Context, q string, topK int) ([]KnowledgeHit, error) {
	if q == "" {
		return nil, nil
	}
	if topK <= 0 {
		topK = 3
	}
	path := fmt.Sprintf("/api/knowledge/search?q=%s&top_k=%d", url.QueryEscape(q), topK)
	var resp knowledgeSearchResponse
	if err := c.doJSON(ctx, "GET", path, nil, &resp); err != nil {
		return nil, err
	}
	return resp.Results, nil
}

// requestIDKey is used to pull a propagated X-Request-ID out of context.
// Handlers stash the gin-context id under "request_id"; we mirror that here
// so engine.Client picks it up automatically without touching every callsite.
type requestIDKeyType struct{}

var requestIDKey = requestIDKeyType{}

// WithRequestID returns ctx tagged with id; engine.Client.doJSON will forward
// it as X-Request-ID on the outbound request.
func WithRequestID(ctx context.Context, id string) context.Context {
	if id == "" || ctx == nil {
		return ctx
	}
	return context.WithValue(ctx, requestIDKey, id)
}

func requestIDFromCtx(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	if v, ok := ctx.Value(requestIDKey).(string); ok {
		return v
	}
	return ""
}

func (c *Client) doJSON(ctx context.Context, method, path string, reqBody interface{}, respBody interface{}) error {
	url := c.baseURL + path

	var bodyReader io.Reader
	if reqBody != nil {
		data, err := json.Marshal(reqBody)
		if err != nil {
			return fmt.Errorf("engine marshal: %w", err)
		}
		bodyReader = bytes.NewReader(data)
	}

	req, err := http.NewRequestWithContext(ctx, method, url, bodyReader)
	if err != nil {
		return fmt.Errorf("engine request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if id := requestIDFromCtx(ctx); id != "" {
		req.Header.Set("X-Request-ID", id)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("engine http: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("engine error %d: %s", resp.StatusCode, string(bodyBytes))
	}

	if respBody != nil && resp.StatusCode != 204 {
		if err := json.NewDecoder(resp.Body).Decode(respBody); err != nil {
			return fmt.Errorf("engine decode: %w", err)
		}
	}

	return nil
}
