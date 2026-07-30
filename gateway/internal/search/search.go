// Package search provides web search capabilities.
//
// Supports multiple search backends:
// - DuckDuckGo HTML search (free, no API key; scrapes html.duckduckgo.com)
// - Bing Web Search API v7 (requires BING_SEARCH_API_KEY)
// - Google Custom Search JSON API (requires GOOGLE_SEARCH_API_KEY + GOOGLE_CSE_CX)
//
// Results are injected into chat context for RAG-like behavior.
package search

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	// Internal packages use EncoreHub's stable reverse-domain namespace.
	"com.0d000721.encorehub/gateway/internal/diagnostics"
	"golang.org/x/net/html"
)

const (
	DefaultMaxResults        = 5
	MaxResults               = 10
	MaxQueryRunes            = 500
	MaxProviderResponseBytes = 2 << 20
)

var ErrProviderResponseTooLarge = errors.New("search provider response exceeds size limit")

// ValidateRequest bounds inputs for every caller, including chat tool calls
// that do not pass through the standalone Search HTTP handler.
func ValidateRequest(query string, maxResults int) error {
	query = strings.TrimSpace(query)
	if query == "" {
		return fmt.Errorf("search query is required")
	}
	if utf8.RuneCountInString(query) > MaxQueryRunes {
		return fmt.Errorf("search query exceeds %d characters", MaxQueryRunes)
	}
	if maxResults < 1 || maxResults > MaxResults {
		return fmt.Errorf("max_results must be between 1 and %d", MaxResults)
	}
	return nil
}

func readProviderResponse(provider string, response *http.Response) ([]byte, error) {
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("%s returned status %d", provider, response.StatusCode)
	}
	if response.ContentLength > MaxProviderResponseBytes {
		return nil, fmt.Errorf("%s: %w", provider, ErrProviderResponseTooLarge)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, MaxProviderResponseBytes+1))
	if err != nil {
		return nil, fmt.Errorf("%s read: %w", provider, err)
	}
	if len(body) > MaxProviderResponseBytes {
		return nil, fmt.Errorf("%s: %w", provider, ErrProviderResponseTooLarge)
	}
	return body, nil
}

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
		p := &Google{apiKey: apiKey, client: diagnostics.NewHTTPClient(10 * time.Second)}
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

// DuckDuckGo provider using the no-JS HTML search endpoint.
// The Instant Answer API (api.duckduckgo.com) only returns encyclopedic
// data (Wikipedia abstracts) and is empty for real-time/news queries.
// The HTML endpoint returns actual web search results.
type DuckDuckGo struct {
	client *http.Client
}

func NewDuckDuckGo() *DuckDuckGo {
	return &DuckDuckGo{client: diagnostics.NewHTTPClient(10 * time.Second)}
}

func (d *DuckDuckGo) Name() string { return "duckduckgo" }

// ddgRedirectRx matches DuckDuckGo redirect URLs like:
//
//	//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com&rut=...
var ddgRedirectRx = regexp.MustCompile(`[?&]uddg=([^&]+)`)

// extractURL decodes a DuckDuckGo redirect URL to the real target URL.
func extractURL(raw string) string {
	m := ddgRedirectRx.FindStringSubmatch(raw)
	if len(m) < 2 {
		return raw
	}
	decoded, err := url.QueryUnescape(m[1])
	if err != nil {
		return raw
	}
	return decoded
}

// stripTags removes HTML tags and common entities from s.
func stripTags(s string) string {
	// Quick path: if there are no angle brackets, just decode entities.
	if !strings.ContainsAny(s, "<>") {
		return html.UnescapeString(strings.TrimSpace(s))
	}
	var b strings.Builder
	inTag := false
	for _, r := range s {
		switch {
		case r == '<':
			inTag = true
		case r == '>':
			inTag = false
		default:
			if !inTag {
				b.WriteRune(r)
			}
		}
	}
	return html.UnescapeString(strings.TrimSpace(b.String()))
}

// collapseWS replaces consecutive whitespace (including newlines) with a single space.
func collapseWS(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

func (d *DuckDuckGo) Search(ctx context.Context, query string, maxResults int) (*SearchResponse, error) {
	query = strings.TrimSpace(query)
	if err := ValidateRequest(query, maxResults); err != nil {
		return nil, err
	}
	apiURL := fmt.Sprintf("https://html.duckduckgo.com/html/?q=%s",
		url.QueryEscape(query))

	req, err := http.NewRequestWithContext(ctx, "GET", apiURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")

	resp, err := d.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("duckduckgo request: %w", err)
	}
	defer resp.Body.Close()

	body, err := readProviderResponse(d.Name(), resp)
	if err != nil {
		return nil, err
	}

	results := parseDDGHTML(string(body), maxResults)

	return &SearchResponse{
		Results:  results,
		Provider: "duckduckgo",
		Query:    query,
	}, nil
}

// parseDDGHTML extracts search results from the DuckDuckGo HTML page.
//
// The HTML uses CSS classes: result__title (h2 > a), result__snippet (a),
// result__url (a). Each result block is a div.result__body containing all
// three. We parse the token stream and track state with a small FSM.
func parseDDGHTML(raw string, maxResults int) []Result {
	if maxResults < 1 {
		return nil
	}
	if maxResults > MaxResults {
		maxResults = MaxResults
	}
	doc, err := html.Parse(strings.NewReader(raw))
	if err != nil {
		return nil
	}

	type state int
	const (
		stIdle      state = iota
		stInBody          // inside a div.result__body
		stInTitle         // inside h2.result__title
		stInSnippet       // inside a.result__snippet
	)

	results := make([]Result, 0, maxResults)
	var cur Result
	var s state
	var titleDepth int

	var walk func(n *html.Node)
	walk = func(n *html.Node) {
		if len(results) >= maxResults {
			return
		}
		if n.Type == html.ElementNode {
			classes := attrVal(n, "class")

			switch {
			case n.Data == "div" && strings.Contains(classes, "result__body"):
				// Start of a new result block.
				if cur.URL != "" || cur.Snippet != "" {
					results = append(results, cur)
				}
				cur = Result{}
				s = stInBody

			case n.Data == "h2" && strings.Contains(classes, "result__title"):
				s = stInTitle
				titleDepth = 0

			case n.Data == "a" && strings.Contains(classes, "result__a") && s == stInTitle:
				// Title link — capture URL from the href.
				href := attrVal(n, "href")
				if cur.URL == "" && href != "" {
					cur.URL = extractURL(href)
				}

			case n.Data == "a" && strings.Contains(classes, "result__snippet"):
				if s == stInBody || s == stInTitle {
					href := attrVal(n, "href")
					if cur.URL == "" && href != "" {
						cur.URL = extractURL(href)
					}
					s = stInSnippet
				}

			case n.Data == "a" && strings.Contains(classes, "result__url"):
				if cur.URL == "" {
					href := attrVal(n, "href")
					if href != "" {
						cur.URL = extractURL(href)
					}
				}
			}
		}

		if n.Type == html.TextNode {
			text := collapseWS(stripTags(n.Data))
			switch s {
			case stInTitle:
				if text != "" {
					if cur.Title != "" {
						cur.Title += " "
					}
					cur.Title += text
					titleDepth++
				}
			case stInSnippet:
				if text != "" {
					if cur.Snippet != "" {
						cur.Snippet += " "
					}
					cur.Snippet += text
				}
			}
		}

		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}

		// When leaving a tracked element, drop back to the parent state.
		if n.Type == html.ElementNode {
			classes := attrVal(n, "class")
			if n.Data == "h2" && strings.Contains(classes, "result__title") {
				s = stInBody
			}
			if n.Data == "a" && strings.Contains(classes, "result__snippet") {
				s = stInBody
			}
		}
	}

	walk(doc)

	// Flush the last result.
	if cur.URL != "" || cur.Snippet != "" {
		results = append(results, cur)
	}

	// Truncate to maxResults.
	if len(results) > maxResults {
		results = results[:maxResults]
	}

	return results
}

// attrVal returns the value of the named attribute on n, or "".
func attrVal(n *html.Node, name string) string {
	for _, a := range n.Attr {
		if a.Key == name {
			return a.Val
		}
	}
	return ""
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
		client: diagnostics.NewHTTPClient(10 * time.Second),
		apiKey: apiKey,
	}
}

func (b *Bing) Name() string { return "bing" }

func (b *Bing) Search(ctx context.Context, query string, maxResults int) (*SearchResponse, error) {
	query = strings.TrimSpace(query)
	if err := ValidateRequest(query, maxResults); err != nil {
		return nil, err
	}
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

	body, err := readProviderResponse(b.Name(), resp)
	if err != nil {
		return nil, err
	}

	var data struct {
		WebPages struct {
			Value []struct {
				Name    string `json:"name"`
				URL     string `json:"url"`
				Snippet string `json:"snippet"`
			} `json:"value"`
		} `json:"webPages"`
	}

	if err := json.Unmarshal(body, &data); err != nil {
		return nil, fmt.Errorf("bing decode: %w", err)
	}

	results := make([]Result, 0, maxResults)
	for _, wp := range data.WebPages.Value {
		if len(results) >= maxResults {
			break
		}
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
	query = strings.TrimSpace(query)
	if err := ValidateRequest(query, maxResults); err != nil {
		return nil, err
	}
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

	body, err := readProviderResponse(g.Name(), resp)
	if err != nil {
		return nil, err
	}

	var data struct {
		Items []struct {
			Title   string `json:"title"`
			Link    string `json:"link"`
			Snippet string `json:"snippet"`
		} `json:"items"`
	}

	if err := json.Unmarshal(body, &data); err != nil {
		return nil, fmt.Errorf("google decode: %w", err)
	}

	results := make([]Result, 0, maxResults)
	for _, item := range data.Items {
		if len(results) >= maxResults {
			break
		}
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
