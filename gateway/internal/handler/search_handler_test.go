package handler

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	// Internal packages use EncoreHub's stable reverse-domain namespace.
	"com.0d000721.encorehub/gateway/internal/search"
	"github.com/gin-gonic/gin"
)

type searchStub struct {
	calls      int
	maxResults int
	err        error
}

func (s *searchStub) Name() string { return "stub" }

func (s *searchStub) Search(_ context.Context, query string, maxResults int) (*search.SearchResponse, error) {
	s.calls++
	s.maxResults = maxResults
	if s.err != nil {
		return nil, s.err
	}
	return &search.SearchResponse{Provider: s.Name(), Query: query}, nil
}

func performSearchRequest(handler *SearchHandler, body []byte) *httptest.ResponseRecorder {
	router := gin.New()
	router.POST("/search", handler.Search)
	request := httptest.NewRequest(http.MethodPost, "/search", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	return recorder
}

func TestSearchRejectsInvalidInputBeforeProviderCall(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, test := range []struct {
		name string
		body string
	}{
		{name: "negative max_results", body: `{"query":"go","max_results":-1}`},
		{name: "excessive max_results", body: `{"query":"go","max_results":11}`},
		{name: "blank query", body: `{"query":"   ","max_results":5}`},
		{name: "long query", body: `{"query":"` + strings.Repeat("界", search.MaxQueryRunes+1) + `","max_results":5}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			provider := &searchStub{}
			recorder := performSearchRequest(NewSearchHandler(provider), []byte(test.body))
			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
			}
			if provider.calls != 0 {
				t.Fatalf("provider called %d times", provider.calls)
			}
		})
	}
}

func TestSearchRejectsOversizedJSONBody(t *testing.T) {
	gin.SetMode(gin.TestMode)
	provider := &searchStub{}
	body := []byte(`{"query":"go","padding":"` + strings.Repeat("x", maxSearchRequestBytes) + `"}`)
	recorder := performSearchRequest(NewSearchHandler(provider), body)

	if recorder.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if provider.calls != 0 {
		t.Fatalf("provider called %d times", provider.calls)
	}
}

func TestSearchBoundsAndDefaultsMaxResults(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, test := range []struct {
		body string
		want int
	}{
		{body: `{"query":"go"}`, want: search.DefaultMaxResults},
		{body: `{"query":"go","max_results":1}`, want: 1},
		{body: `{"query":"go","max_results":10}`, want: search.MaxResults},
	} {
		provider := &searchStub{}
		recorder := performSearchRequest(NewSearchHandler(provider), []byte(test.body))
		if recorder.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
		}
		if provider.maxResults != test.want {
			t.Fatalf("max_results = %d, want %d", provider.maxResults, test.want)
		}
	}
}

func TestSearchMapsProviderFailureToBadGateway(t *testing.T) {
	gin.SetMode(gin.TestMode)
	provider := &searchStub{err: errors.New("upstream failed")}
	recorder := performSearchRequest(NewSearchHandler(provider), []byte(`{"query":"go"}`))
	if recorder.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
}
