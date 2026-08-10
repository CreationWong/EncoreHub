package search

import (
	"context"
	"net/url"
	"strings"
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

func TestDuckDuckGoInstantAnswerParsesNestedTopicsInProviderOrder(t *testing.T) {
	var request fetchRequest
	provider, err := NewProvider("duckduckgo", WithFetcher(fixtureFetcher(t, `{
		"Heading":"EncoreHub","AbstractText":"Primary answer","AbstractURL":"https://example.com/answer",
		"RelatedTopics":[{"Name":"group","Topics":[
			{"Text":"First topic - detail","FirstURL":"https://example.com/first"},
			{"Text":"Duplicate","FirstURL":"https://example.com/first"},
			{"Text":"Second topic - detail","FirstURL":"https://example.org/second"}
		]}]
	}`, &request)))
	if err != nil {
		t.Fatalf("new provider: %v", err)
	}
	response, err := provider.Search(context.Background(), "EncoreHub release notes", 3)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if request.Policy != FetchPolicyPublicAPI || request.MaxBytes != MaxProviderResponseBytes {
		t.Fatalf("unexpected fetch policy: %+v", request)
	}
	parsed, _ := url.Parse(request.URL)
	if parsed.Host != "api.duckduckgo.com" || parsed.Query().Get("q") != "EncoreHub release notes" {
		t.Fatalf("unexpected request URL: %s", request.URL)
	}
	if len(response.Results) != 3 || response.Results[0].URL != "https://example.com/answer" || response.Results[1].URL != "https://example.com/first" || response.Results[2].URL != "https://example.org/second" {
		t.Fatalf("provider order or deduplication changed: %+v", response.Results)
	}
}

func TestDuckDuckGoEmptyInstantAnswerIsValid(t *testing.T) {
	var request fetchRequest
	provider, _ := NewProvider("duckduckgo", WithFetcher(fixtureFetcher(t, `{}`, &request)))
	response, err := provider.Search(context.Background(), "new topic", 5)
	if err != nil {
		t.Fatalf("empty response should be valid: %v", err)
	}
	if len(response.Results) != 0 {
		t.Fatalf("expected no results: %+v", response.Results)
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
