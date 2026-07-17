package search

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

type panicReader struct{}

func (panicReader) Read([]byte) (int, error) {
	panic("provider body was read before status validation")
}

const sampleDDGHTML = `<!DOCTYPE html>
<html>
<body>
<div class="links_main links_deep result__body">
    <h2 class="result__title">
        <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage1&amp;rut=abc123">First Result Title</a>
    </h2>
    <div class="result__extras">
        <div class="result__extras__url">
            <span class="result__icon">
                <img class="result__icon__img" width="16" height="16" alt="" src="//external-content.duckduckgo.com/ip3/example.com.ico" />
            </span>
            <a class="result__url" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage1&amp;rut=abc123">example.com/page1</a>
            <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage1&amp;rut=abc123">This is the <b>first</b> result snippet with some text.</a>
        </div>
    </div>
</div>
<div class="links_main links_deep result__body">
    <h2 class="result__title">
        <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fsecond&amp;rut=def456">Second <b>Result</b> Title</a>
    </h2>
    <div class="result__extras">
        <div class="result__extras__url">
            <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fsecond&amp;rut=def456">Another snippet for the second result.</a>
        </div>
    </div>
</div>
<div class="links_main links_deep result__body">
    <h2 class="result__title">
        <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fno-snippet.example%2Fthird&amp;rut=ghi789">Third Title Only</a>
    </h2>
</div>
</body>
</html>`

func TestParseDDGHTML(t *testing.T) {
	results := parseDDGHTML(sampleDDGHTML, 10)
	if len(results) != 3 {
		t.Fatalf("expected 3 results, got %d", len(results))
	}

	// Result 1
	if results[0].Title != "First Result Title" {
		t.Errorf("result[0].Title = %q, want %q", results[0].Title, "First Result Title")
	}
	if results[0].URL != "https://example.com/page1" {
		t.Errorf("result[0].URL = %q, want %q", results[0].URL, "https://example.com/page1")
	}
	if !strings.Contains(results[0].Snippet, "first result snippet") {
		t.Errorf("result[0].Snippet = %q, want to contain %q", results[0].Snippet, "first result snippet")
	}

	// Result 2 — title has <b> tags that should be stripped.
	if results[1].Title != "Second Result Title" {
		t.Errorf("result[1].Title = %q, want %q", results[1].Title, "Second Result Title")
	}
	if results[1].URL != "https://example.org/second" {
		t.Errorf("result[1].URL = %q, want %q", results[1].URL, "https://example.org/second")
	}

	// Result 3 — no snippet present.
	if results[2].Title != "Third Title Only" {
		t.Errorf("result[2].Title = %q, want %q", results[2].Title, "Third Title Only")
	}
	if results[2].URL != "https://no-snippet.example/third" {
		t.Errorf("result[2].URL = %q, want %q", results[2].URL, "https://no-snippet.example/third")
	}
	if results[2].Snippet != "" {
		t.Errorf("result[2].Snippet = %q, want empty", results[2].Snippet)
	}
}

func TestParseDDGHTML_MaxResults(t *testing.T) {
	results := parseDDGHTML(sampleDDGHTML, 2)
	if len(results) != 2 {
		t.Fatalf("expected 2 results (maxResults=2), got %d", len(results))
	}
}

func TestParseDDGHTML_InvalidMaxResultsDoesNotPanic(t *testing.T) {
	if results := parseDDGHTML(sampleDDGHTML, -1); len(results) != 0 {
		t.Fatalf("expected no results, got %d", len(results))
	}
}

func TestProvidersRejectOversizedResponses(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode:    http.StatusOK,
			Body:          io.NopCloser(strings.NewReader(strings.Repeat("x", MaxProviderResponseBytes+1))),
			ContentLength: -1,
			Header:        make(http.Header),
		}, nil
	})}
	providers := []Provider{
		&DuckDuckGo{client: client},
		&Bing{client: client, apiKey: "key"},
		&Google{client: client, apiKey: "key", cseCX: "cx"},
	}
	for _, provider := range providers {
		t.Run(provider.Name(), func(t *testing.T) {
			_, err := provider.Search(context.Background(), "go", 5)
			if !errors.Is(err, ErrProviderResponseTooLarge) {
				t.Fatalf("error = %v, want ErrProviderResponseTooLarge", err)
			}
		})
	}
}

func TestProvidersCheckStatusBeforeReadingBody(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusBadGateway,
			Body:       io.NopCloser(panicReader{}),
			Header:     make(http.Header),
		}, nil
	})}
	providers := []Provider{
		&DuckDuckGo{client: client},
		&Bing{client: client, apiKey: "key"},
		&Google{client: client, apiKey: "key", cseCX: "cx"},
	}
	for _, provider := range providers {
		t.Run(provider.Name(), func(t *testing.T) {
			if _, err := provider.Search(context.Background(), "go", 5); err == nil {
				t.Fatal("expected upstream status error")
			}
		})
	}
}

func TestExtractURL(t *testing.T) {
	tests := []struct {
		raw  string
		want string
	}{
		{
			"//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com&rut=abc",
			"https://example.com",
		},
		{
			"//duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FGo&rut=xyz",
			"https://en.wikipedia.org/wiki/Go",
		},
		{
			"https://example.com/direct",
			"https://example.com/direct",
		},
		{
			"",
			"",
		},
	}

	for _, tt := range tests {
		got := extractURL(tt.raw)
		if got != tt.want {
			t.Errorf("extractURL(%q) = %q, want %q", tt.raw, got, tt.want)
		}
	}
}

func TestStripTags(t *testing.T) {
	tests := []struct {
		raw  string
		want string
	}{
		{"plain text", "plain text"},
		{"<b>bold</b> text", "bold text"},
		{"no tags here", "no tags here"},
		{"<a href='x'>link text</a>", "link text"},
		{"text with &amp; entity", "text with & entity"},
		{"", ""},
	}

	for _, tt := range tests {
		got := stripTags(tt.raw)
		if got != tt.want {
			t.Errorf("stripTags(%q) = %q, want %q", tt.raw, got, tt.want)
		}
	}
}

func TestNewProvider(t *testing.T) {
	// duckduckgo should work without an API key
	p, err := NewProvider("duckduckgo", "", WithGoogleCSEcx(""))
	if err != nil {
		t.Fatalf("unexpected error for duckduckgo: %v", err)
	}
	if p.Name() != "duckduckgo" {
		t.Errorf("expected name duckduckgo, got %s", p.Name())
	}

	// bing requires an API key
	_, err = NewProvider("bing", "", WithGoogleCSEcx(""))
	if err == nil {
		t.Error("expected error for bing without API key")
	}

	// google requires an API key and CSE CX
	_, err = NewProvider("google", "", WithGoogleCSEcx(""))
	if err == nil {
		t.Error("expected error for google without API key")
	}

	// unknown provider
	_, err = NewProvider("yahoo", "", WithGoogleCSEcx(""))
	if err == nil {
		t.Error("expected error for unknown provider")
	}
}
