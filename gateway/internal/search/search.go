// Package search provides web search capabilities.
//
// Supports multiple search backends:
// - DuckDuckGo Instant Answer API (free, no API key)
// - Bing Web Search API v7 (requires BING_SEARCH_API_KEY)
// - Google Custom Search JSON API (requires GOOGLE_SEARCH_API_KEY + GOOGLE_CSE_CX)
//
// Results are injected into chat context for RAG-like behavior.
package search

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
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

// NewProvider creates a search provider by name.
//
// Supported names: "duckduckgo", "bing", "google".
//   - duckduckgo: no key required
//   - bing: pass apiKey (BING_SEARCH_API_KEY)
//   - google: pass apiKey (GOOGLE_SEARCH_API_KEY); the key is used with GOOGLE_CSE_CX
//     which must be set via WithGoogleCSEcx.
func NewProvider(name, apiKey string, opts ...ProviderOption) (Provider, error) {
	switch strings.ToLower(name) {
	case "duckduckgo":
		return NewDuckDuckGo(), nil
	case "bing":
		if apiKey == "" {
			return nil, fmt.Errorf("bing search: missing API key")
		}
		return NewBing(apiKey), nil
	case "google":
		if apiKey == "" {
			return nil, fmt.Errorf("google search: missing API key")
		}
		p := &Google{apiKey: apiKey, client: &http.Client{Timeout: 10 * time.Second}}
		for _, opt := range opts {
			opt(p)
		}
		if p.cseCX == "" {
			return nil, fmt.Errorf("google search: missing CSE CX (set via WithGoogleCSEcx or GOOGLE_CSE_CX env)")
		}
		return p, nil
	default:
		return nil, fmt.Errorf("unknown search provider: %q (supported: duckduckgo, bing, google)", name)
	}
}

// ProviderOption configures a search provider.
type ProviderOption func(interface{})

// WithGoogleCSEcx sets the Google Custom Search Engine ID.
func WithGoogleCSEcx(cx string) ProviderOption {
	return func(p interface{}) {
		if g, ok := p.(*Google); ok {
			g.cseCX = cx
		}
	}
}

// ============================================================
// DuckDuckGo provider
// ============================================================

// DuckDuckGo provider using the free Instant Answer API.
type DuckDuckGo struct {
	client *http.Client
}

func NewDuckDuckGo() *DuckDuckGo {
	return &DuckDuckGo{client: &http.Client{Timeout: 10 * time.Second}}
}

func (d *DuckDuckGo) Name() string { return "duckduckgo" }

func (d *DuckDuckGo) Search(ctx context.Context, query string, maxResults int) (*SearchResponse, error) {
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

// ============================================================
// Bing Search API v7 provider
// ============================================================

// Bing provider using the Bing Web Search API v7.
type Bing struct {
	client *http.Client
	apiKey string
}

func NewBing(apiKey string) *Bing {
	return &Bing{
		client:  &http.Client{Timeout: 10 * time.Second},
		apiKey:  apiKey,
	}
}

func (b *Bing) Name() string { return "bing" }

func (b *Bing) Search(ctx context.Context, query string, maxResults int) (*SearchResponse, error) {
	apiURL := fmt.Sprintf("https://api.bing.microsoft.com/v7.0/search?q=%s&count=%d&mkt=en-US",
		url.QueryEscape(query), maxResults)

	req, err := http.NewRequestWithContext(ctx, "GET", apiURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Ocp-Apim-Subscription-Key", b.apiKey)
	req.Header.Set("User-Agent", "EncoreHub/0.1")

	resp, err := b.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("bing request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("bing API returned status %d", resp.StatusCode)
	}

	var data struct {
		WebPages struct {
			Value []struct {
				Name  string `json:"name"`
				URL   string `json:"url"`
				Snippet string `json:"snippet"`
			} `json:"value"`
		} `json:"webPages"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, fmt.Errorf("bing decode: %w", err)
	}

	results := make([]Result, 0, maxResults)
	for _, wp := range data.WebPages.Value {
		results = append(results, Result{
			Title:   wp.Name,
			URL:     wp.URL,
			Snippet: wp.Snippet,
		})
	}

	return &SearchResponse{
		Results:  results,
		Provider: "bing",
		Query:    query,
	}, nil
}

// ============================================================
// Google Custom Search JSON API provider
// ============================================================

// Google provider using the Custom Search JSON API.
type Google struct {
	client *http.Client
	apiKey string
	cseCX  string
}

func (g *Google) Name() string { return "google" }

func (g *Google) Search(ctx context.Context, query string, maxResults int) (*SearchResponse, error) {
	apiURL := fmt.Sprintf(
		"https://www.googleapis.com/customsearch/v1?key=%s&cx=%s&q=%s&num=%d",
		url.QueryEscape(g.apiKey),
		url.QueryEscape(g.cseCX),
		url.QueryEscape(query),
		maxResults,
	)

	req, err := http.NewRequestWithContext(ctx, "GET", apiURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "EncoreHub/0.1")

	resp, err := g.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("google request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("google API returned status %d", resp.StatusCode)
	}

	var data struct {
		Items []struct {
			Title   string `json:"title"`
			Link    string `json:"link"`
			Snippet string `json:"snippet"`
		} `json:"items"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, fmt.Errorf("google decode: %w", err)
	}

	results := make([]Result, 0, maxResults)
	for _, item := range data.Items {
		results = append(results, Result{
			Title:   item.Title,
			URL:     item.Link,
			Snippet: item.Snippet,
		})
	}

	return &SearchResponse{
		Results:  results,
		Provider: "google",
		Query:    query,
	}, nil
}

// ============================================================
// Formatter
// ============================================================

// FormatForContext formats search results as a string for injection into chat context.
func FormatForContext(resp *SearchResponse) string {
	if resp == nil || len(resp.Results) == 0 {
		return ""
	}

	out := fmt.Sprintf("\n\n[Web Search Results for: \"%s\" — Source: %s]\n", resp.Query, strings.ToUpper(resp.Provider))
	for i, r := range resp.Results {
		out += fmt.Sprintf("%d. %s\n   %s\n   URL: %s\n\n", i+1, r.Title, r.Snippet, r.URL)
	}
	return out
}
