package diagnostics

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/rs/zerolog/log"
)

const maxCapturedBodyBytes = 512 * 1024

var enabled atomic.Bool

func init() {
	enabled.Store(environmentEnabled(os.Getenv("ENCOREHUB_DEVELOPER_MODE")))
}

// Enabled reports whether full local communication diagnostics are active.
func Enabled() bool {
	return enabled.Load()
}

// SetEnabled is primarily useful to embedded callers and tests. The desktop
// app normally changes the environment flag and restarts the Gateway.
func SetEnabled(value bool) {
	enabled.Store(value)
}

// NewHTTPClient returns a client whose transport records request and response
// bodies only while developer diagnostics are enabled.
func NewHTTPClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Transport: TraceTransport(http.DefaultTransport),
		Timeout:   timeout,
	}
}

// TraceTransport wraps an existing transport without changing its behavior
// when diagnostics are disabled.
func TraceTransport(base http.RoundTripper) http.RoundTripper {
	if base == nil {
		base = http.DefaultTransport
	}
	return roundTripper{base: base}
}

type roundTripper struct {
	base http.RoundTripper
}

func (transport roundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	if !Enabled() {
		return transport.base.RoundTrip(request)
	}

	started := time.Now()
	activity := databaseActivity(request)
	requestBody, requestTruncated, err := snapshotRequestBody(request)
	if err != nil {
		log.Info().
			Str("channel", "communication").
			Str("direction", "outbound-request").
			Str("activity", activity).
			Str("method", request.Method).
			Str("url", sanitizedURL(request.URL)).
			Str("capture_error", err.Error()).
			Msg("developer communication trace")
	} else {
		log.Info().
			Str("channel", "communication").
			Str("direction", "outbound-request").
			Str("activity", activity).
			Str("method", request.Method).
			Str("url", sanitizedURL(request.URL)).
			Interface("headers", sanitizedHeaders(request.Header)).
			Str("body", requestBody).
			Bool("body_truncated", requestTruncated).
			Msg("developer communication trace")
	}

	response, err := transport.base.RoundTrip(request)
	if err != nil {
		log.Info().
			Str("channel", "communication").
			Str("direction", "outbound-response").
			Str("activity", activity).
			Str("method", request.Method).
			Str("url", sanitizedURL(request.URL)).
			Dur("duration", time.Since(started)).
			Str("error", err.Error()).
			Msg("developer communication trace")
		return nil, err
	}

	response.Body = &captureReadCloser{
		ReadCloser: response.Body,
		remaining:  maxCapturedBodyBytes,
		onComplete: func(body string, truncated bool) {
			log.Info().
				Str("channel", "communication").
				Str("direction", "outbound-response").
				Str("activity", activity).
				Str("method", request.Method).
				Str("url", sanitizedURL(request.URL)).
				Int("status", response.StatusCode).
				Interface("headers", sanitizedHeaders(response.Header)).
				Dur("duration", time.Since(started)).
				Str("body", body).
				Bool("body_truncated", truncated).
				Msg("developer communication trace")
		},
	}
	return response, nil
}

type captureReadCloser struct {
	io.ReadCloser
	buffer     bytes.Buffer
	remaining  int
	truncated  bool
	onComplete func(string, bool)
	once       sync.Once
}

func (body *captureReadCloser) Read(buffer []byte) (int, error) {
	count, err := body.ReadCloser.Read(buffer)
	if count > 0 {
		captured := count
		if captured > body.remaining {
			captured = body.remaining
			body.truncated = true
		}
		if captured > 0 {
			_, _ = body.buffer.Write(buffer[:captured])
			body.remaining -= captured
		}
		if captured < count {
			body.truncated = true
		}
	}
	if err != nil {
		body.complete()
	}
	return count, err
}

func (body *captureReadCloser) Close() error {
	error := body.ReadCloser.Close()
	body.complete()
	return error
}

func (body *captureReadCloser) complete() {
	body.once.Do(func() {
		body.onComplete(body.buffer.String(), body.truncated)
	})
}

func snapshotRequestBody(request *http.Request) (string, bool, error) {
	if request.Body == nil {
		return "", false, nil
	}
	body, err := io.ReadAll(request.Body)
	if err != nil {
		return "", false, err
	}
	request.Body = io.NopCloser(bytes.NewReader(body))
	if len(body) <= maxCapturedBodyBytes {
		return string(body), false, nil
	}
	return string(body[:maxCapturedBodyBytes]), true, nil
}

func sanitizedHeaders(headers http.Header) map[string][]string {
	result := make(map[string][]string, len(headers))
	for key, values := range headers {
		if sensitiveName(key) {
			result[key] = []string{"[redacted]"}
			continue
		}
		result[key] = append([]string(nil), values...)
	}
	return result
}

func sanitizedURL(value *url.URL) string {
	if value == nil {
		return ""
	}
	copy := *value
	query := copy.Query()
	for key := range query {
		if sensitiveName(key) {
			query.Set(key, "[redacted]")
		}
	}
	copy.RawQuery = query.Encode()
	return copy.String()
}

func sensitiveName(value string) bool {
	value = strings.ToLower(value)
	if value == "key" || strings.HasSuffix(value, "-key") || strings.HasSuffix(value, "_key") {
		return true
	}
	for _, fragment := range []string{"authorization", "api-key", "apikey", "token", "secret", "cookie", "subscription-key"} {
		if strings.Contains(value, fragment) {
			return true
		}
	}
	return false
}

func environmentEnabled(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func databaseActivity(request *http.Request) string {
	if request == nil || request.URL == nil {
		return ""
	}
	engineURL := strings.TrimSpace(os.Getenv("ENGINE_URL"))
	if engineURL == "" {
		engineURL = "http://127.0.0.1:3000"
	}
	engine, err := url.Parse(engineURL)
	if err != nil || !strings.EqualFold(engine.Scheme, request.URL.Scheme) || !strings.EqualFold(engine.Host, request.URL.Host) {
		return ""
	}
	switch request.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return "database/read"
	default:
		return "database/write"
	}
}

func (transport roundTripper) String() string {
	return fmt.Sprintf("diagnostics.roundTripper(%T)", transport.base)
}
