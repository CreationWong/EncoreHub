// Exa neural search: keyless hosted MCP or a user-supplied REST API key.
//
// EncoreHub treats Exa as one search provider with two access modes so a
// user can search without creating an account, then upgrade in place.
//
// Free mode POSTs JSON-RPC tools/call web_search_exa to the hosted MCP
// endpoint. Exa documents that path as keyless and rate-limited. The
// response may be a JSON object or an SSE stream; both are decoded here.
//
// API-key mode POSTs to the official Search REST API with x-api-key. The
// key is loaded from Engine secrets (id web_search_exa) and must never be
// written to web_search_settings or logs. Missing keys fail closed.
//
// Both endpoints are fixed public APIs, so Engine Curl uses the public
// search-provider policy rather than the user-configured private exception.

package search

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

// Protocol notes used while mapping Exa payloads into Result:
//
// REST /search returns {results:[{title,url,text,highlights[]}]}. A highlight
// is usually the better snippet for chat context, so it wins over text.
//
// MCP tools/call returns JSON-RPC. Streamable HTTP may wrap the same object
// in SSE `data:` lines; we keep the last data payload. result.content is an
// array of text blocks. Those blocks may contain JSON results, Title/URL
// labeled records, or both. Empty content or isError is a provider failure.
//
// Rate limit 429 is mapped to a user-facing error on the free path so the
// settings panel can suggest switching to an API key. Status codes otherwise
// go through requireSuccess. URLs still pass normalizeResults, which drops
// credentialed or non-http(s) links.
//
// FetchCall.Method is POST for both modes. Engine Curl must allow POST bodies
// for search_provider purpose; public_page stays GET-only. Headers may carry
// x-api-key only on the REST path. The free MCP call sends no auth header.

const (
	// ExaSecretID is the Engine secrets row for a user-supplied Exa key.
	ExaSecretID = "web_search_exa"
	// ExaModeFree uses the hosted MCP endpoint with no credentials.
	ExaModeFree = "free"
	// ExaModeAPIKey uses REST search authenticated with the stored key.
	ExaModeAPIKey = "api_key"

	exaRESTURL = "https://api.exa.ai/search"
	exaMCPURL  = "https://mcp.exa.ai/mcp"
)

// ExaConfig selects the free MCP path or REST with a vaulted API key.
type ExaConfig struct {
	Mode   string
	APIKey string
}

// Exa is the structured search adapter for Exa's public search APIs.
type Exa struct {
	fetcher Fetcher
	config  ExaConfig
}

// Name identifies this adapter in search settings and tool results.
func (e *Exa) Name() string { return "exa" }

// normalizedExaMode maps unknown or empty values to the free hosted path.
func normalizedExaMode(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case ExaModeAPIKey:
		return ExaModeAPIKey
	default:
		return ExaModeFree
	}
}

// validateExaConfig requires a key only when REST mode is selected.
func validateExaConfig(config ExaConfig) error {
	if normalizedExaMode(config.Mode) == ExaModeAPIKey && strings.TrimSpace(config.APIKey) == "" {
		return fmt.Errorf("exa search: API key is required for api_key mode")
	}
	return nil
}

// Search dispatches to REST or MCP after validating the query bounds.
func (e *Exa) Search(ctx context.Context, query string, maxResults int) (*SearchResponse, error) {
	query = strings.TrimSpace(query)
	if err := ValidateRequest(query, maxResults); err != nil {
		return nil, err
	}
	if normalizedExaMode(e.config.Mode) == ExaModeAPIKey {
		return e.searchREST(ctx, query, maxResults)
	}
	return e.searchMCP(ctx, query, maxResults)
}

// searchREST calls api.exa.ai. Highlights are preferred over full page text.
func (e *Exa) searchREST(ctx context.Context, query string, maxResults int) (*SearchResponse, error) {
	payload, err := json.Marshal(map[string]any{
		"query":      query,
		"numResults": maxResults,
		"type":       "auto",
		"contents":   map[string]any{"highlights": true, "text": false},
	})
	if err != nil {
		return nil, fmt.Errorf("exa rest encode: %w", err)
	}
	status, _, _, body, err := e.fetcher.FetchSearch(ctx, FetchCall{
		URL:    exaRESTURL,
		Method: http.MethodPost,
		Headers: map[string]string{
			"Accept":       "application/json",
			"Content-Type": "application/json",
			"x-api-key":    strings.TrimSpace(e.config.APIKey),
		},
		Body:     payload,
		MaxBytes: MaxProviderResponseBytes,
		Policy:   FetchPolicyPublicAPI,
	})
	if err != nil {
		return nil, fmt.Errorf("exa rest request: %w", err)
	}
	if status == http.StatusTooManyRequests {
		return nil, fmt.Errorf("exa rest returned status 429")
	}
	if err := requireSuccess("exa rest", status); err != nil {
		return nil, err
	}
	results, err := parseExaRESTResults(body)
	if err != nil {
		return nil, err
	}
	return &SearchResponse{
		Results:  normalizeResults(results, maxResults),
		Provider: e.Name(),
		Query:    query,
	}, nil
}

// searchMCP calls the hosted MCP tool without credentials.
func (e *Exa) searchMCP(ctx context.Context, query string, maxResults int) (*SearchResponse, error) {
	payload, err := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "tools/call",
		"params": map[string]any{
			"name": "web_search_exa",
			"arguments": map[string]any{
				"query":      query,
				"numResults": maxResults,
			},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("exa mcp encode: %w", err)
	}
	status, _, _, body, err := e.fetcher.FetchSearch(ctx, FetchCall{
		URL:    exaMCPURL,
		Method: http.MethodPost,
		Headers: map[string]string{
			"Accept":       "application/json, text/event-stream",
			"Content-Type": "application/json",
		},
		Body:     payload,
		MaxBytes: MaxProviderResponseBytes,
		Policy:   FetchPolicyPublicAPI,
	})
	if err != nil {
		return nil, fmt.Errorf("exa mcp request: %w", err)
	}
	if status == http.StatusTooManyRequests {
		return nil, fmt.Errorf("exa free API rate limited; add an API key or try again later")
	}
	if err := requireSuccess("exa mcp", status); err != nil {
		return nil, err
	}
	results, err := parseExaMCPResults(body)
	if err != nil {
		return nil, err
	}
	return &SearchResponse{
		Results:  normalizeResults(results, maxResults),
		Provider: e.Name(),
		Query:    query,
	}, nil
}

type exaRESTItem struct {
	Title      string   `json:"title"`
	URL        string   `json:"url"`
	Text       string   `json:"text"`
	Highlights []string `json:"highlights"`
}

// parseExaRESTResults maps the official Search API result list.
func parseExaRESTResults(body []byte) ([]Result, error) {
	var payload struct {
		Results []exaRESTItem `json:"results"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("exa rest decode: %w", err)
	}
	return mapExaRESTItems(payload.Results), nil
}

// mapExaRESTItems prefers a highlight snippet when Exa returned both fields.
func mapExaRESTItems(items []exaRESTItem) []Result {
	results := make([]Result, 0, len(items))
	for _, item := range items {
		snippet := strings.TrimSpace(item.Text)
		if len(item.Highlights) > 0 {
			snippet = strings.TrimSpace(item.Highlights[0])
		}
		results = append(results, Result{
			Title:   item.Title,
			URL:     item.URL,
			Snippet: snippet,
			Kind:    ResultKindWeb,
		})
	}
	return results
}

type mcpEnvelope struct {
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
	Result struct {
		IsError bool `json:"isError"`
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	} `json:"result"`
}

// parseExaMCPResults reads JSON-RPC tool content and rejects MCP error envelopes.
func parseExaMCPResults(body []byte) ([]Result, error) {
	payload, err := extractJSONRPCPayload(body)
	if err != nil {
		return nil, err
	}
	var envelope mcpEnvelope
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return nil, fmt.Errorf("exa mcp decode: %w", err)
	}
	if envelope.Error != nil && envelope.Error.Message != "" {
		return nil, fmt.Errorf("exa mcp: %s", envelope.Error.Message)
	}
	if envelope.Result.IsError {
		return nil, fmt.Errorf("exa mcp tool returned an error")
	}
	results := make([]Result, 0)
	for _, block := range envelope.Result.Content {
		if strings.TrimSpace(block.Text) == "" {
			continue
		}
		results = append(results, parseExaMCPText(block.Text)...)
	}
	if len(results) == 0 {
		return nil, fmt.Errorf("exa mcp returned no recognizable results")
	}
	return results, nil
}

// extractJSONRPCPayload accepts a raw JSON body or the last SSE data line.
func extractJSONRPCPayload(body []byte) ([]byte, error) {
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) == 0 {
		return nil, fmt.Errorf("exa mcp returned an empty body")
	}
	// Direct JSON-RPC responses skip the SSE envelope entirely.
	if trimmed[0] == '{' {
		return trimmed, nil
	}
	var last []byte
	for _, line := range strings.Split(string(trimmed), "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		// Keep the last event; MCP streams may emit progress then the result.
		if data == "" || data == "[DONE]" {
			continue
		}
		last = []byte(data)
	}
	if len(last) == 0 {
		return nil, fmt.Errorf("exa mcp returned no JSON payload")
	}
	return last, nil
}

// parseExaMCPText tries structured JSON first, then Title/URL labeled blocks.
func parseExaMCPText(text string) []Result {
	if items := parseExaJSONText(text); len(items) > 0 {
		return items
	}
	return parseExaLabeledBlocks(text)
}

// parseExaJSONText accepts either a results object or a bare result array.
func parseExaJSONText(text string) []Result {
	trimmed := strings.TrimSpace(text)
	if !strings.HasPrefix(trimmed, "{") && !strings.HasPrefix(trimmed, "[") {
		return nil
	}
	var object struct {
		Results []exaRESTItem `json:"results"`
	}
	if err := json.Unmarshal([]byte(trimmed), &object); err == nil && len(object.Results) > 0 {
		return mapExaRESTItems(object.Results)
	}
	var list []exaRESTItem
	if err := json.Unmarshal([]byte(trimmed), &list); err == nil && len(list) > 0 {
		return mapExaRESTItems(list)
	}
	return nil
}

// parseExaLabeledBlocks reconstructs results from MCP's human-readable dump.
func parseExaLabeledBlocks(text string) []Result {
	results := make([]Result, 0)
	current := Result{Kind: ResultKindWeb}
	// A record is only kept when it has a URL; title-only lines are ignored.
	flush := func() {
		if strings.TrimSpace(current.URL) == "" {
			current = Result{Kind: ResultKindWeb}
			return
		}
		results = append(results, current)
		current = Result{Kind: ResultKindWeb}
	}
	for _, rawLine := range strings.Split(text, "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" {
			// Blank lines separate MCP's per-result blocks.
			flush()
			continue
		}
		key, value, found := strings.Cut(line, ":")
		if !found {
			// Unlabeled text is a snippet fallback for the current record.
			if current.Snippet == "" {
				current.Snippet = line
			}
			continue
		}
		label := strings.ToLower(strings.TrimSpace(key))
		value = strings.TrimSpace(value)
		switch label {
		case "title", "name":
			// A second title after a URL starts a new record.
			if current.URL != "" && current.Title != "" {
				flush()
			}
			current.Title = value
		case "url", "link", "href":
			if current.URL != "" {
				flush()
			}
			current.URL = value
		case "snippet", "text", "summary", "content", "highlight":
			current.Snippet = value
		}
	}
	flush()
	return results
}
