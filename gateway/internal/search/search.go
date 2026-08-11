// Package search provides structured web-search API adapters.
package search

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"path"
	"strings"
	"unicode/utf8"

	"golang.org/x/net/html"
)

const (
	DefaultMaxResults        = 5
	MaxResults               = 10
	MaxQueryRunes            = 500
	MaxProviderResponseBytes = 2 << 20
)

// Result is the provider-neutral search result returned to chat tools.
type Result struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Snippet string `json:"snippet"`
}

// SearchResponse wraps normalized results and preserves the original query.
type SearchResponse struct {
	Results  []Result `json:"results"`
	Provider string   `json:"provider"`
	Query    string   `json:"query"`
}

// Provider executes one structured search API request.
type Provider interface {
	Name() string
	Search(context.Context, string, int) (*SearchResponse, error)
}

// FetchPolicy distinguishes fixed public APIs from endpoints explicitly
// configured by the user, which may be self-hosted on a private address.
type FetchPolicy string

const (
	FetchPolicyPublicAPI     FetchPolicy = "public_api"
	FetchPolicyConfiguredAPI FetchPolicy = "configured_api"
)

// Fetcher is implemented by Engine's bounded Curl network service.
type Fetcher interface {
	FetchSearchURL(
		context.Context,
		string,
		map[string]string,
		int,
		FetchPolicy,
	) (status int, contentType, finalURL string, body []byte, err error)
}

type SearXNGConfig struct {
	Endpoint string
}

type OpenSERPConfig struct {
	Endpoint string
	Engine   string
	Engines  string
}

type ProviderOption func(Provider)

func WithFetcher(fetcher Fetcher) ProviderOption {
	return func(provider Provider) {
		switch value := provider.(type) {
		case *DuckDuckGo:
			value.fetcher = fetcher
		case *DuckDuckGoHTML:
			value.fetcher = fetcher
		case *SearXNG:
			value.fetcher = fetcher
		case *OpenSERP:
			value.fetcher = fetcher
		}
	}
}

func WithSearXNGConfig(config SearXNGConfig) ProviderOption {
	return func(provider Provider) {
		if value, ok := provider.(*SearXNG); ok {
			value.config = config
		}
	}
}

func WithOpenSERPConfig(config OpenSERPConfig) ProviderOption {
	return func(provider Provider) {
		if value, ok := provider.(*OpenSERP); ok {
			value.config = config
		}
	}
}

// NewProvider constructs one of EncoreHub's supported structured APIs.
func NewProvider(name string, options ...ProviderOption) (Provider, error) {
	var provider Provider
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "duckduckgo":
		provider = &DuckDuckGo{}
	case "duckduckgo_html":
		provider = &DuckDuckGoHTML{}
	case "searxng":
		provider = &SearXNG{}
	case "openserp":
		provider = &OpenSERP{}
	default:
		return nil, fmt.Errorf("unknown search provider %q (supported: duckduckgo, duckduckgo_html, searxng, openserp)", name)
	}
	for _, option := range options {
		option(provider)
	}
	if err := validateProvider(provider); err != nil {
		return nil, err
	}
	return provider, nil
}

func validateProvider(provider Provider) error {
	switch value := provider.(type) {
	case *DuckDuckGo:
		if value.fetcher == nil {
			return fmt.Errorf("duckduckgo search: Curl fetcher is required")
		}
	case *DuckDuckGoHTML:
		if value.fetcher == nil {
			return fmt.Errorf("duckduckgo HTML search: Curl fetcher is required")
		}
	case *SearXNG:
		if value.fetcher == nil {
			return fmt.Errorf("searxng search: Curl fetcher is required")
		}
		if _, err := parseConfiguredEndpoint(value.config.Endpoint); err != nil {
			return fmt.Errorf("searxng search: %w", err)
		}
	case *OpenSERP:
		if value.fetcher == nil {
			return fmt.Errorf("openserp search: Curl fetcher is required")
		}
		if _, err := parseConfiguredEndpoint(value.config.Endpoint); err != nil {
			return fmt.Errorf("openserp search: %w", err)
		}
		if !validOpenSERPEngine(value.config.Engine) {
			return fmt.Errorf("openserp search: unsupported engine %q", value.config.Engine)
		}
	}
	return nil
}

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

type DuckDuckGo struct {
	fetcher Fetcher
}

func (d *DuckDuckGo) Name() string { return "duckduckgo" }

func (d *DuckDuckGo) Search(ctx context.Context, query string, maxResults int) (*SearchResponse, error) {
	query = strings.TrimSpace(query)
	if err := ValidateRequest(query, maxResults); err != nil {
		return nil, err
	}
	requestURL := "https://api.duckduckgo.com/?" + url.Values{
		"q":             {query},
		"format":        {"json"},
		"no_html":       {"1"},
		"no_redirect":   {"1"},
		"skip_disambig": {"0"},
	}.Encode()
	status, _, _, body, err := d.fetcher.FetchSearchURL(
		ctx,
		requestURL,
		map[string]string{"Accept": "application/json"},
		MaxProviderResponseBytes,
		FetchPolicyPublicAPI,
	)
	if err != nil {
		return nil, fmt.Errorf("duckduckgo Instant Answer request: %w", err)
	}
	if err := requireSuccess("duckduckgo Instant Answer", status); err != nil {
		return nil, err
	}
	var payload duckDuckGoPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("duckduckgo Instant Answer decode: %w", err)
	}
	candidates := make([]Result, 0, maxResults)
	if payload.AbstractURL != "" && payload.AbstractText != "" {
		candidates = append(candidates, Result{
			Title:   firstNonEmpty(payload.Heading, payload.AbstractSource, query),
			URL:     payload.AbstractURL,
			Snippet: payload.AbstractText,
		})
	}
	if payload.DefinitionURL != "" && payload.Definition != "" {
		candidates = append(candidates, Result{
			Title:   firstNonEmpty(payload.DefinitionSource, payload.Heading, query),
			URL:     payload.DefinitionURL,
			Snippet: payload.Definition,
		})
	}
	appendDuckDuckGoTopics(&candidates, payload.Results)
	appendDuckDuckGoTopics(&candidates, payload.RelatedTopics)
	return &SearchResponse{
		Results:  normalizeResults(candidates, maxResults),
		Provider: d.Name(),
		Query:    query,
	}, nil
}

type duckDuckGoTopic struct {
	FirstURL string            `json:"FirstURL"`
	Text     string            `json:"Text"`
	Topics   []duckDuckGoTopic `json:"Topics"`
}

type duckDuckGoPayload struct {
	Heading          string            `json:"Heading"`
	AbstractText     string            `json:"AbstractText"`
	AbstractSource   string            `json:"AbstractSource"`
	AbstractURL      string            `json:"AbstractURL"`
	Definition       string            `json:"Definition"`
	DefinitionSource string            `json:"DefinitionSource"`
	DefinitionURL    string            `json:"DefinitionURL"`
	Results          []duckDuckGoTopic `json:"Results"`
	RelatedTopics    []duckDuckGoTopic `json:"RelatedTopics"`
}

func appendDuckDuckGoTopics(results *[]Result, topics []duckDuckGoTopic) {
	for _, topic := range topics {
		if topic.FirstURL != "" && topic.Text != "" {
			*results = append(*results, Result{
				Title:   duckDuckGoTopicTitle(topic.Text, topic.FirstURL),
				URL:     topic.FirstURL,
				Snippet: topic.Text,
			})
		}
		appendDuckDuckGoTopics(results, topic.Topics)
	}
}

func duckDuckGoTopicTitle(text, rawURL string) string {
	if before, _, found := strings.Cut(text, " - "); found && strings.TrimSpace(before) != "" {
		return strings.TrimSpace(before)
	}
	if parsed, err := url.Parse(rawURL); err == nil && parsed.Hostname() != "" {
		return parsed.Hostname()
	}
	return "DuckDuckGo result"
}

// DuckDuckGoHTML reads DuckDuckGo's explicit HTML search endpoint. It is a
// separate, user-selected provider rather than a fallback from Instant Answer.
type DuckDuckGoHTML struct {
	fetcher Fetcher
}

func (d *DuckDuckGoHTML) Name() string { return "duckduckgo_html" }

func (d *DuckDuckGoHTML) Search(ctx context.Context, query string, maxResults int) (*SearchResponse, error) {
	query = strings.TrimSpace(query)
	if err := ValidateRequest(query, maxResults); err != nil {
		return nil, err
	}
	requestURL := "https://html.duckduckgo.com/html/?" + url.Values{"q": {query}}.Encode()
	status, contentType, _, body, err := d.fetcher.FetchSearchURL(
		ctx,
		requestURL,
		map[string]string{
			"Accept":          "text/html,application/xhtml+xml",
			"Accept-Language": "en-US,en;q=0.8",
			"User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
		},
		MaxProviderResponseBytes,
		FetchPolicyPublicAPI,
	)
	if err != nil {
		return nil, fmt.Errorf("duckduckgo HTML request: %w", err)
	}
	if status == 202 || looksLikeDuckDuckGoVerification(body) {
		return nil, fmt.Errorf("duckduckgo HTML requires human verification")
	}
	if err := requireSuccess("duckduckgo HTML", status); err != nil {
		return nil, err
	}
	if !strings.Contains(strings.ToLower(contentType), "html") {
		return nil, fmt.Errorf("duckduckgo HTML returned unexpected content type")
	}
	document, err := html.Parse(strings.NewReader(string(body)))
	if err != nil {
		return nil, fmt.Errorf("duckduckgo HTML decode: %w", err)
	}
	candidates := parseDuckDuckGoHTMLResults(document)
	if len(candidates) == 0 && !htmlTreeHasClass(document, "no-results") {
		return nil, fmt.Errorf("duckduckgo HTML returned no recognizable result markup")
	}
	return &SearchResponse{
		Results:  normalizeResults(candidates, maxResults),
		Provider: d.Name(),
		Query:    query,
	}, nil
}

func parseDuckDuckGoHTMLResults(document *html.Node) []Result {
	results := make([]Result, 0)
	var visit func(*html.Node)
	visit = func(node *html.Node) {
		if node.Type == html.ElementNode && htmlNodeHasClass(node, "result") {
			link := htmlFindDescendantByClass(node, "result__a")
			if link != nil {
				href := htmlAttribute(link, "href")
				if href != "" {
					snippet := htmlFindDescendantByClass(node, "result__snippet")
					results = append(results, Result{
						Title:   htmlNodeText(link),
						URL:     decodeDuckDuckGoResultURL(href),
						Snippet: htmlNodeText(snippet),
					})
				}
			}
			return
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			visit(child)
		}
	}
	visit(document)
	return results
}

func decodeDuckDuckGoResultURL(raw string) string {
	value := strings.TrimSpace(raw)
	if strings.HasPrefix(value, "//") {
		value = "https:" + value
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return value
	}
	host := strings.ToLower(parsed.Hostname())
	if (host == "duckduckgo.com" || host == "www.duckduckgo.com") && parsed.Path == "/l/" {
		if target := parsed.Query().Get("uddg"); target != "" {
			return target
		}
	}
	return value
}

func looksLikeDuckDuckGoVerification(body []byte) bool {
	content := strings.ToLower(string(body))
	return strings.Contains(content, "challenge-form") ||
		strings.Contains(content, "anomaly-modal") ||
		strings.Contains(content, "duckduckgo.com/verify.js") ||
		strings.Contains(content, "bots use duckduckgo")
}

func htmlTreeHasClass(node *html.Node, className string) bool {
	if node == nil {
		return false
	}
	if htmlNodeHasClass(node, className) {
		return true
	}
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		if htmlTreeHasClass(child, className) {
			return true
		}
	}
	return false
}

func htmlFindDescendantByClass(node *html.Node, className string) *html.Node {
	if node == nil {
		return nil
	}
	if htmlNodeHasClass(node, className) {
		return node
	}
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		if found := htmlFindDescendantByClass(child, className); found != nil {
			return found
		}
	}
	return nil
}

func htmlNodeHasClass(node *html.Node, className string) bool {
	if node == nil || node.Type != html.ElementNode {
		return false
	}
	for _, class := range strings.Fields(htmlAttribute(node, "class")) {
		if class == className {
			return true
		}
	}
	return false
}

func htmlAttribute(node *html.Node, name string) string {
	if node == nil {
		return ""
	}
	for _, attribute := range node.Attr {
		if attribute.Key == name {
			return attribute.Val
		}
	}
	return ""
}

func htmlNodeText(node *html.Node) string {
	if node == nil {
		return ""
	}
	if node.Type == html.ElementNode && (node.Data == "script" || node.Data == "style") {
		return ""
	}
	if node.Type == html.TextNode {
		return node.Data
	}
	var builder strings.Builder
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		builder.WriteString(" ")
		builder.WriteString(htmlNodeText(child))
	}
	return collapseWS(builder.String())
}

type SearXNG struct {
	fetcher Fetcher
	config  SearXNGConfig
}

func (s *SearXNG) Name() string { return "searxng" }

func (s *SearXNG) Search(ctx context.Context, query string, maxResults int) (*SearchResponse, error) {
	query = strings.TrimSpace(query)
	if err := ValidateRequest(query, maxResults); err != nil {
		return nil, err
	}
	requestURL, err := configuredAPIURL(s.config.Endpoint, "search")
	if err != nil {
		return nil, fmt.Errorf("searxng search: %w", err)
	}
	values := requestURL.Query()
	values.Set("q", query)
	values.Set("format", "json")
	values.Set("language", "auto")
	values.Set("pageno", "1")
	requestURL.RawQuery = values.Encode()
	status, _, _, body, err := s.fetcher.FetchSearchURL(
		ctx,
		requestURL.String(),
		map[string]string{"Accept": "application/json"},
		MaxProviderResponseBytes,
		FetchPolicyConfiguredAPI,
	)
	if err != nil {
		return nil, fmt.Errorf("searxng request: %w", err)
	}
	if err := requireSuccess("searxng", status); err != nil {
		return nil, err
	}
	var payload struct {
		Results []struct {
			Title   string `json:"title"`
			URL     string `json:"url"`
			Content string `json:"content"`
		} `json:"results"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("searxng decode: %w", err)
	}
	candidates := make([]Result, 0, len(payload.Results))
	for _, item := range payload.Results {
		candidates = append(candidates, Result{Title: item.Title, URL: item.URL, Snippet: item.Content})
	}
	return &SearchResponse{
		Results:  normalizeResults(candidates, maxResults),
		Provider: s.Name(),
		Query:    query,
	}, nil
}

type OpenSERP struct {
	fetcher Fetcher
	config  OpenSERPConfig
}

func (o *OpenSERP) Name() string { return "openserp" }

func (o *OpenSERP) Search(ctx context.Context, query string, maxResults int) (*SearchResponse, error) {
	query = strings.TrimSpace(query)
	if err := ValidateRequest(query, maxResults); err != nil {
		return nil, err
	}
	engine := normalizedOpenSERPEngine(o.config.Engine)
	requestURL, err := configuredAPIURL(o.config.Endpoint, engine+"/search")
	if err != nil {
		return nil, fmt.Errorf("openserp search: %w", err)
	}
	values := requestURL.Query()
	values.Set("text", query)
	values.Set("limit", fmt.Sprintf("%d", maxResults))
	values.Set("format", "json")
	if engine == "mega" {
		values.Set("mode", "balanced")
		if engines := normalizeOpenSERPEngines(o.config.Engines); engines != "" {
			values.Set("engines", engines)
		}
	}
	requestURL.RawQuery = values.Encode()
	status, _, _, body, err := o.fetcher.FetchSearchURL(
		ctx,
		requestURL.String(),
		map[string]string{"Accept": "application/json"},
		MaxProviderResponseBytes,
		FetchPolicyConfiguredAPI,
	)
	if err != nil {
		return nil, fmt.Errorf("openserp request: %w", err)
	}
	if err := requireSuccess("openserp", status); err != nil {
		return nil, err
	}
	var payload struct {
		Results []struct {
			Type    string `json:"type"`
			Title   string `json:"title"`
			URL     string `json:"url"`
			Snippet string `json:"snippet"`
		} `json:"results"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("openserp decode: %w", err)
	}
	candidates := make([]Result, 0, len(payload.Results))
	for _, item := range payload.Results {
		if item.Type != "" && item.Type != "organic" {
			continue
		}
		candidates = append(candidates, Result{Title: item.Title, URL: item.URL, Snippet: item.Snippet})
	}
	return &SearchResponse{
		Results:  normalizeResults(candidates, maxResults),
		Provider: o.Name(),
		Query:    query,
	}, nil
}

func parseConfiguredEndpoint(raw string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("endpoint must be an absolute URL")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, fmt.Errorf("endpoint must use HTTP or HTTPS")
	}
	if parsed.User != nil {
		return nil, fmt.Errorf("endpoint cannot contain credentials")
	}
	return parsed, nil
}

func configuredAPIURL(endpoint, suffix string) (*url.URL, error) {
	parsed, err := parseConfiguredEndpoint(endpoint)
	if err != nil {
		return nil, err
	}
	cleanSuffix := strings.Trim(suffix, "/")
	if strings.Trim(parsed.Path, "/") == cleanSuffix || strings.HasSuffix(strings.Trim(parsed.Path, "/"), "/"+cleanSuffix) {
		return parsed, nil
	}
	parsed.Path = path.Join(parsed.Path, cleanSuffix)
	return parsed, nil
}

var openSERPEngines = map[string]struct{}{
	"mega":       {},
	"google":     {},
	"bing":       {},
	"duckduckgo": {},
	"baidu":      {},
	"yandex":     {},
	"ecosia":     {},
}

func normalizedOpenSERPEngine(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return "mega"
	}
	return value
}

func validOpenSERPEngine(value string) bool {
	_, exists := openSERPEngines[normalizedOpenSERPEngine(value)]
	return exists
}

func normalizeOpenSERPEngines(value string) string {
	seen := make(map[string]struct{})
	engines := make([]string, 0)
	for _, candidate := range strings.Split(value, ",") {
		candidate = strings.ToLower(strings.TrimSpace(candidate))
		if candidate == "" || candidate == "mega" {
			continue
		}
		if _, valid := openSERPEngines[candidate]; !valid {
			continue
		}
		if _, exists := seen[candidate]; exists {
			continue
		}
		seen[candidate] = struct{}{}
		engines = append(engines, candidate)
	}
	return strings.Join(engines, ",")
}

func requireSuccess(provider string, status int) error {
	if status < 200 || status >= 300 {
		return fmt.Errorf("%s returned status %d", provider, status)
	}
	return nil
}

func normalizeResults(candidates []Result, maxResults int) []Result {
	results := make([]Result, 0, min(maxResults, len(candidates)))
	seen := make(map[string]struct{})
	for _, candidate := range candidates {
		if len(results) >= min(maxResults, MaxResults) {
			break
		}
		parsed, err := url.Parse(strings.TrimSpace(candidate.URL))
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil {
			continue
		}
		parsed.Fragment = ""
		normalizedURL := parsed.String()
		if _, exists := seen[normalizedURL]; exists {
			continue
		}
		seen[normalizedURL] = struct{}{}
		title := collapseWS(candidate.Title)
		if title == "" {
			title = parsed.Hostname()
		}
		results = append(results, Result{
			Title:   title,
			URL:     normalizedURL,
			Snippet: collapseWS(candidate.Snippet),
		})
	}
	return results
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value = collapseWS(value); value != "" {
			return value
		}
	}
	return "Search result"
}

func collapseWS(value string) string {
	return strings.Join(strings.Fields(value), " ")
}

// FormatForContext preserves the provider order and marks the data boundary.
func FormatForContext(response *SearchResponse) string {
	if response == nil || len(response.Results) == 0 {
		return "No search results found."
	}
	var builder strings.Builder
	fmt.Fprintf(&builder, "UNTRUSTED WEB SEARCH DATA\nQuery: %s\nProvider: %s\n\n", response.Query, response.Provider)
	for index, result := range response.Results {
		fmt.Fprintf(&builder, "%d. %s\n%s\nURL: %s\n\n", index+1, result.Title, result.Snippet, result.URL)
	}
	builder.WriteString("END UNTRUSTED WEB SEARCH DATA")
	return builder.String()
}
