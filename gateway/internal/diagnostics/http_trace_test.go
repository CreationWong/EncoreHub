package diagnostics

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

func TestEnvironmentEnabled(t *testing.T) {
	for _, value := range []string{"1", "true", "YES", "on"} {
		if !environmentEnabled(value) {
			t.Fatalf("expected %q to enable diagnostics", value)
		}
	}
	for _, value := range []string{"", "0", "false", "off"} {
		if environmentEnabled(value) {
			t.Fatalf("expected %q to disable diagnostics", value)
		}
	}
}

func TestRestrictedTraceRecordsMetadataWithoutBodies(t *testing.T) {
	SetEnabled(false)
	var output bytes.Buffer
	previousLogger := log.Logger
	log.Logger = zerolog.New(&output)
	t.Cleanup(func() { log.Logger = previousLogger })

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(writer, `{"answer":"private-response"}`)
	}))
	defer server.Close()

	client := &http.Client{Transport: TraceTransport(http.DefaultTransport)}
	response, err := client.Post(
		server.URL+"?api_key=private-query",
		"application/json",
		strings.NewReader(`{"prompt":"private-request"}`),
	)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, response.Body)

	logged := output.String()
	for _, secret := range []string{"private-request", "private-response", "private-query"} {
		if strings.Contains(logged, secret) {
			t.Fatalf("restricted trace leaked %q: %s", secret, logged)
		}
	}
	for _, metadata := range []string{"restricted communication trace", `"method":"POST"`, `"status":200`} {
		if !strings.Contains(logged, metadata) {
			t.Fatalf("restricted trace missing %q: %s", metadata, logged)
		}
	}
}

func TestTraceTransportPreservesRequestAndResponseBodies(t *testing.T) {
	SetEnabled(true)
	t.Cleanup(func() { SetEnabled(false) })

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatalf("read request body: %v", err)
		}
		if string(body) != `{"prompt":"hello"}` {
			t.Fatalf("request body changed: %q", body)
		}
		_, _ = io.WriteString(writer, `{"answer":"world"}`)
	}))
	defer server.Close()

	client := &http.Client{Transport: TraceTransport(http.DefaultTransport)}
	response, err := client.Post(server.URL, "application/json", strings.NewReader(`{"prompt":"hello"}`))
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read response body: %v", err)
	}
	if string(body) != `{"answer":"world"}` {
		t.Fatalf("response body changed: %q", body)
	}
}

func TestSanitizedURLAndHeadersHideCredentials(t *testing.T) {
	request, err := http.NewRequest("GET", "https://example.com/models?api_key=secret&query=kept", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer secret")
	request.Header.Set("X-Request-ID", "visible")

	url := sanitizedURL(request.URL)
	if strings.Contains(url, "secret") || !strings.Contains(url, "query=kept") {
		t.Fatalf("unexpected sanitized URL: %s", url)
	}
	headers := sanitizedHeaders(request.Header)
	if headers["Authorization"][0] != "[redacted]" {
		t.Fatalf("authorization header was not redacted: %#v", headers)
	}
	if headers["X-Request-Id"][0] != "visible" {
		t.Fatalf("safe header changed: %#v", headers)
	}
}

func TestDatabaseActivityClassifiesEngineReadsAndWrites(t *testing.T) {
	t.Setenv("ENGINE_URL", "http://127.0.0.1:3210")
	read, _ := http.NewRequest(http.MethodGet, "http://127.0.0.1:3210/api/conversations", nil)
	write, _ := http.NewRequest(http.MethodPost, "http://127.0.0.1:3210/api/conversations", nil)
	provider, _ := http.NewRequest(http.MethodPost, "https://api.example.com/chat", nil)

	if databaseActivity(read) != "database/read" {
		t.Fatalf("expected Engine GET to be classified as a database read")
	}
	if databaseActivity(write) != "database/write" {
		t.Fatalf("expected Engine POST to be classified as a database write")
	}
	if databaseActivity(provider) != "" {
		t.Fatalf("provider request must not be classified as database activity")
	}
}
