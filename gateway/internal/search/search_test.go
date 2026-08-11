package search

import (
	"context"
	"net/url"
	"strings"
	"sync"
	"testing"
)

type fetchRequest struct {
	URL      string
	Headers  map[string]string
	MaxBytes int
	Policy   FetchPolicy
}

type fetchFunc func(context.Context, string, map[string]string, int, FetchPolicy) (int, string, string, []byte, error)

func (f fetchFunc) FetchSearchURL(ctx context.Context, rawURL string, headers map[string]string, maxBytes int, policy FetchPolicy) (int, string, string, []byte, error) {
	return f(ctx, rawURL, headers, maxBytes, policy)
}

func fixtureFetcher(t *testing.T, body string, captured *fetchRequest) fetchFunc {
	t.Helper()
	return func(_ context.Context, rawURL string, headers map[string]string, maxBytes int, policy FetchPolicy) (int, string, string, []byte, error) {
		*captured = fetchRequest{URL: rawURL, Headers: headers, MaxBytes: maxBytes, Policy: policy}
		return 200, "application/json", rawURL, []byte(body), nil
	}
}

func TestDuckDuckGoCombinesFeaturedAnswersWithHTMLResults(t *testing.T) {
	requests := make([]fetchRequest, 0, 2)
	var requestsMu sync.Mutex
	provider, err := NewProvider("duckduckgo", WithFetcher(fetchFunc(
		func(_ context.Context, rawURL string, headers map[string]string, maxBytes int, policy FetchPolicy) (int, string, string, []byte, error) {
			requestsMu.Lock()
			requests = append(requests, fetchRequest{URL: rawURL, Headers: headers, MaxBytes: maxBytes, Policy: policy})
			requestsMu.Unlock()
			parsed, _ := url.Parse(rawURL)
			if parsed.Host == "api.duckduckgo.com" {
				return 200, "application/json", rawURL, []byte(`{
					"Heading":"EncoreHub","AbstractText":"Primary answer","AbstractURL":"https://example.com/answer",
					"RelatedTopics":[{"Text":"Related detail","FirstURL":"https://example.com/related"}]
				}`), nil
			}
			return 200, "text/html", rawURL, []byte(`<!doctype html><html><body>
				<div class="result"><a class="result__a" href="https://example.org/first">First web result</a><div class="result__snippet">First snippet</div></div>
				<div class="result"><a class="result__a" href="https://example.net/second">Second web result</a><div class="result__snippet">Second snippet</div></div>
			</body></html>`), nil
		},
	)))
	if err != nil {
		t.Fatalf("new provider: %v", err)
	}
	response, err := provider.Search(context.Background(), "EncoreHub release notes", 2)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(requests) != 2 {
		t.Fatalf("DuckDuckGo requests = %d, want HTML and Instant Answer", len(requests))
	}
	if response.Provider != "duckduckgo" || len(response.Results) != 4 {
		t.Fatalf("unexpected combined response: %+v", response)
	}
	featured, web := resultsByKind(response.Results)
	if len(featured) != 2 || featured[0].URL != "https://example.com/answer" ||
		len(web) != 2 || web[0].URL != "https://example.org/first" || web[1].URL != "https://example.net/second" {
		t.Fatalf("featured or web result order changed: %+v", response.Results)
	}
}

func TestDuckDuckGoUsesHTMLWhenInstantAnswerIsEmpty(t *testing.T) {
	provider, _ := NewProvider("duckduckgo", WithFetcher(fetchFunc(
		func(_ context.Context, rawURL string, _ map[string]string, _ int, _ FetchPolicy) (int, string, string, []byte, error) {
			parsed, _ := url.Parse(rawURL)
			if parsed.Host == "api.duckduckgo.com" {
				return 200, "application/json", rawURL, []byte(`{}`), nil
			}
			return 200, "text/html", rawURL, []byte(`<div class="result"><a class="result__a" href="https://example.com/web">Web result</a></div>`), nil
		},
	)))
	response, err := provider.Search(context.Background(), "new topic", 5)
	if err != nil {
		t.Fatalf("HTML results should remain available: %v", err)
	}
	featured, web := resultsByKind(response.Results)
	if len(featured) != 0 || len(web) != 1 || web[0].URL != "https://example.com/web" {
		t.Fatalf("unexpected composite results: %+v", response.Results)
	}
	if len(response.Warnings) != 0 {
		t.Fatalf("empty Instant Answer should not be a warning: %+v", response.Warnings)
	}
}

func TestDuckDuckGoKeepsFeaturedAnswerWhenHTMLNeedsVerification(t *testing.T) {
	provider, _ := NewProvider("duckduckgo", WithFetcher(fetchFunc(
		func(_ context.Context, rawURL string, _ map[string]string, _ int, _ FetchPolicy) (int, string, string, []byte, error) {
			parsed, _ := url.Parse(rawURL)
			if parsed.Host == "api.duckduckgo.com" {
				return 200, "application/json", rawURL, []byte(`{"Heading":"Topic","AbstractText":"Featured summary","AbstractURL":"https://example.com/answer"}`), nil
			}
			return 202, "text/html", rawURL, []byte(`<form id="challenge-form">verify</form>`), nil
		},
	)))
	response, err := provider.Search(context.Background(), "topic", 5)
	if err != nil {
		t.Fatalf("featured answer should survive HTML verification: %v", err)
	}
	featured, web := resultsByKind(response.Results)
	if len(featured) != 1 || len(web) != 0 || len(response.Warnings) != 1 ||
		!strings.Contains(response.Warnings[0], "human verification") {
		t.Fatalf("unexpected partial response: %+v", response)
	}
}

func resultsByKind(results []Result) (featured, web []Result) {
	for _, result := range results {
		if result.Kind == ResultKindFeaturedAnswer {
			featured = append(featured, result)
		} else {
			web = append(web, result)
		}
	}
	return featured, web
}

func TestDuckDuckGoHTMLParsesOrganicResultsAndRedirects(t *testing.T) {
	var request fetchRequest
	provider := &DuckDuckGoHTML{fetcher: fetchFunc(
		func(_ context.Context, rawURL string, headers map[string]string, maxBytes int, policy FetchPolicy) (int, string, string, []byte, error) {
			request = fetchRequest{URL: rawURL, Headers: headers, MaxBytes: maxBytes, Policy: policy}
			return 200, "text/html", rawURL, []byte(`<!doctype html><html><body>
				<script>ignored()</script><style>.ignored{}</style>
				<p>CAPTCHA documentation is a legitimate search topic.</p>
				<div class="result results_links">
					<h2><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Ffirst&amp;rut=abc"><b>First</b> result</a></h2>
					<a class="result__snippet">First <strong>snippet</strong></a>
				</div>
				<div class="result results_links">
					<a class="result__a" href="https://example.org/second">Second result</a>
					<div class="result__snippet">Second snippet</div>
				</div>
			</body></html>`), nil
		},
	)}
	response, err := provider.Search(context.Background(), "2026年7月新番", 2)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	parsed, _ := url.Parse(request.URL)
	if parsed.Scheme != "https" || parsed.Host != "html.duckduckgo.com" || parsed.Path != "/html/" ||
		parsed.Query().Get("q") != "2026年7月新番" || request.Policy != FetchPolicyPublicAPI {
		t.Fatalf("unexpected HTML request: %+v", request)
	}
	if request.Headers["Accept"] != "text/html,application/xhtml+xml" {
		t.Fatalf("HTML accept header missing: %+v", request.Headers)
	}
	if response.Provider != "duckduckgo_html" || len(response.Results) != 2 ||
		response.Results[0].URL != "https://example.com/first" ||
		response.Results[0].Title != "First result" || response.Results[0].Snippet != "First snippet" ||
		response.Results[1].URL != "https://example.org/second" {
		t.Fatalf("unexpected HTML results: %+v", response)
	}
}

func TestDuckDuckGoHTMLRejectsHumanVerificationResponse(t *testing.T) {
	provider := &DuckDuckGoHTML{fetcher: fetchFunc(
		func(_ context.Context, rawURL string, _ map[string]string, _ int, _ FetchPolicy) (int, string, string, []byte, error) {
			return 202, "text/html", rawURL, []byte(`<html><body><form id="challenge-form">CAPTCHA</form></body></html>`), nil
		},
	)}
	_, err := provider.Search(context.Background(), "EncoreHub", 5)
	if err == nil || !strings.Contains(err.Error(), "human verification") {
		t.Fatalf("verification response was accepted: %v", err)
	}
}

func TestSearXNGBuildsJSONRequestAndMapsResults(t *testing.T) {
	var request fetchRequest
	provider, err := NewProvider("searxng",
		WithFetcher(fixtureFetcher(t, `{"results":[{"title":"First","url":"https://example.com/1","content":"One"},{"title":"Second","url":"https://example.com/2","content":"Two"}]}`, &request)),
		WithSearXNGConfig(SearXNGConfig{Endpoint: "http://127.0.0.1:8888/base"}),
	)
	if err != nil {
		t.Fatalf("new provider: %v", err)
	}
	response, err := provider.Search(context.Background(), "release notes", 2)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	parsed, _ := url.Parse(request.URL)
	if parsed.Path != "/base/search" || parsed.Query().Get("q") != "release notes" || parsed.Query().Get("format") != "json" || request.Policy != FetchPolicyConfiguredAPI {
		t.Fatalf("unexpected SearXNG request: %+v", request)
	}
	if len(response.Results) != 2 || response.Results[0].Title != "First" || response.Results[1].Title != "Second" {
		t.Fatalf("unexpected response: %+v", response)
	}
}

func TestOpenSERPMegaBuildsBalancedRequestAndKeepsOrganicResults(t *testing.T) {
	var request fetchRequest
	provider, err := NewProvider("openserp",
		WithFetcher(fixtureFetcher(t, `{"results":[{"type":"answer","title":"Skip","url":"https://example.com/skip"},{"type":"organic","title":"First","url":"https://example.com/1","snippet":"One"},{"title":"Second","url":"https://example.com/2","snippet":"Two"}]}`, &request)),
		WithOpenSERPConfig(OpenSERPConfig{Endpoint: "http://localhost:7000", Engine: "mega", Engines: "google,bing,google,invalid"}),
	)
	if err != nil {
		t.Fatalf("new provider: %v", err)
	}
	response, err := provider.Search(context.Background(), "ETS2 1.61", 4)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	parsed, _ := url.Parse(request.URL)
	query := parsed.Query()
	if parsed.Path != "/mega/search" || query.Get("text") != "ETS2 1.61" || query.Get("limit") != "4" || query.Get("mode") != "balanced" || query.Get("engines") != "google,bing" || request.Policy != FetchPolicyConfiguredAPI {
		t.Fatalf("unexpected OpenSERP request: %+v", request)
	}
	if len(response.Results) != 2 || response.Results[0].Title != "First" || response.Results[1].Title != "Second" {
		t.Fatalf("unexpected organic results: %+v", response.Results)
	}
}

func TestOpenSERPSingleEngineUsesDedicatedRoute(t *testing.T) {
	var request fetchRequest
	provider, err := NewProvider("openserp",
		WithFetcher(fixtureFetcher(t, `{"results":[]}`, &request)),
		WithOpenSERPConfig(OpenSERPConfig{Endpoint: "https://search.example/api", Engine: "duckduckgo"}),
	)
	if err != nil {
		t.Fatalf("new provider: %v", err)
	}
	if _, err := provider.Search(context.Background(), "query", 1); err != nil {
		t.Fatalf("search: %v", err)
	}
	if !strings.Contains(request.URL, "/api/duckduckgo/search?") || strings.Contains(request.URL, "mode=") {
		t.Fatalf("unexpected single-engine route: %s", request.URL)
	}
}

func TestConfiguredProvidersRejectUnsafeEndpointShapes(t *testing.T) {
	for _, endpoint := range []string{"/search", "file:///tmp/search", "https://user:pass@example.com/search"} {
		if _, err := NewProvider("searxng", WithFetcher(fetchFunc(nil)), WithSearXNGConfig(SearXNGConfig{Endpoint: endpoint})); err == nil {
			t.Fatalf("expected endpoint %q to be rejected", endpoint)
		}
	}
}

func TestValidateRequestBoundsQueryAndCount(t *testing.T) {
	if err := ValidateRequest("", 5); err == nil {
		t.Fatal("expected empty query error")
	}
	if err := ValidateRequest(strings.Repeat("界", MaxQueryRunes+1), 5); err == nil {
		t.Fatal("expected long query error")
	}
	if err := ValidateRequest("valid", MaxResults+1); err == nil {
		t.Fatal("expected max-results error")
	}
}

func TestFormatForContextSeparatesFeaturedAnswersAndWebResults(t *testing.T) {
	formatted := FormatForContext(&SearchResponse{
		Provider: "duckduckgo",
		Query:    "topic",
		Warnings: []string{"DuckDuckGo HTML failed: human verification required"},
		Results: []Result{
			{Kind: ResultKindFeaturedAnswer, Title: "Featured", URL: "https://example.com/answer", Snippet: "Summary"},
			{Kind: ResultKindWeb, Title: "Web", URL: "https://example.org/page", Snippet: "Snippet"},
		},
	})
	for _, expected := range []string{
		"FEATURED ANSWERS OR SUMMARIES",
		"WEB SEARCH RESULTS",
		"Provider warning: DuckDuckGo HTML failed: human verification required",
		"https://example.com/answer",
		"https://example.org/page",
	} {
		if !strings.Contains(formatted, expected) {
			t.Fatalf("formatted context missing %q: %s", expected, formatted)
		}
	}
}
