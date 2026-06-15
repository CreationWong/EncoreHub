// Package search provides web search capabilities.
//
// Supports multiple search backends:
// - DuckDuckGo Instant Answer API (free, no API key)
// - Brave Search API (requires key)
//
// Results are injected into chat context for RAG-like behavior.
package search

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

// Result represents a single search result.
type Result struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Snippet string `json:"snippet"`
}

// SearchResponse wraps search results.
type SearchResponse struct {
	Results  []Result `json:"results"`
	Provider string   `json:"provider"`
	Query    string   `json:"query"`
}

// Provider executes web searches.
type Provider interface {
	Search(ctx context.Context, query string, maxResults int) (*SearchResponse, error)
	Name() string
}

// DuckDuckGo provider using the free Instant Answer API.
type DuckDuckGo struct {
	client *http.Client
}

func NewDuckDuckGo() *DuckDuckGo {
	return &DuckDuckGo{client: &http.Client{Timeout: 10 * time.Second}}
}

func (d *DuckDuckGo) Name() string { return "duckduckgo" }

func (d *DuckDuckGo) Search(ctx context.Context, query string, maxResults int) (*SearchResponse, error) {
	// DuckDuckGo Instant Answer API — returns JSON with AbstractText, RelatedTopics, etc.
	apiURL := fmt.Sprintf("https://api.duckduckgo.com/?q=%s&format=json&no_html=1&skip_disambig=1",
		url.QueryEscape(query))

	req, err := http.NewRequestWithContext(ctx, "GET", apiURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "EncoreHub/0.1")

	resp, err := d.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("duckduckgo request: %w", err)
	}
	defer resp.Body.Close()

	var data struct {
		AbstractText   string `json:"AbstractText"`
		AbstractURL    string `json:"AbstractURL"`
		AbstractSource string `json:"AbstractSource"`
		Heading        string `json:"Heading"`
		RelatedTopics  []struct {
			Text     string `json:"Text"`
			FirstURL string `json:"FirstURL"`
		} `json:"RelatedTopics"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, fmt.Errorf("duckduckgo decode: %w", err)
	}

	results := make([]Result, 0, maxResults)

	// Main abstract
	if data.AbstractText != "" {
		results = append(results, Result{
			Title:   data.Heading,
			URL:     data.AbstractURL,
			Snippet: data.AbstractText,
		})
	}

	// Related topics
	for _, topic := range data.RelatedTopics {
		if len(results) >= maxResults {
			break
		}
		if topic.Text != "" && topic.FirstURL != "" {
			results = append(results, Result{
				Title:   "",
				URL:     topic.FirstURL,
				Snippet: topic.Text,
			})
		}
	}

	return &SearchResponse{
		Results:  results,
		Provider: "duckduckgo",
		Query:    query,
	}, nil
}

// FormatForContext formats search results as a string for injection into chat context.
func FormatForContext(resp *SearchResponse) string {
	if resp == nil || len(resp.Results) == 0 {
		return ""
	}

	out := fmt.Sprintf("\n\n[Web Search Results for: \"%s\"]\n", resp.Query)
	for i, r := range resp.Results {
		out += fmt.Sprintf("%d. %s\n   %s\n   URL: %s\n\n", i+1, r.Title, r.Snippet, r.URL)
	}
	return out
}
