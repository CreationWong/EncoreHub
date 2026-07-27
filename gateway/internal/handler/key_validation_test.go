package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

const validationCanary = "CUI07-CANARY-secret-url-response"

func TestValidateKeyReturnsStructuredPoolAndEndpointHealth(t *testing.T) {
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/models") {
			t.Fatalf("path = %q", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer good-key" {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":"` + validationCanary + `"}`))
			return
		}
		_, _ = w.Write([]byte(`{"data":[]}`))
	}))
	defer primary.Close()

	backup := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(validationCanary))
	}))
	defer backup.Close()

	requestBody := `{"protocol":"openai","endpoints":[` +
		`{"id":"primary","base_url":"` + primary.URL + `/` + validationCanary + `","enabled":true},` +
		`{"id":"backup","base_url":"` + backup.URL + `/v1","enabled":true}]}`
	keyPool := `{"version":1,"keys":[` +
		`{"id":"bad","name":"` + validationCanary + `","value":"bad-key","enabled":true},` +
		`{"id":"good","name":"Good","value":"good-key","enabled":true},` +
		`{"id":"disabled","name":"Disabled","value":"disabled-key","enabled":false}]}`

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/providers/custom/validate-key", bytes.NewBufferString(requestBody))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Provider-Key", keyPool)
	context.Request = request
	context.Params = gin.Params{{Key: "provider", Value: "custom"}}

	handler := &ProviderHandler{client: primary.Client()}
	handler.ValidateKey(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	responseBody := recorder.Body.String()
	if strings.Contains(responseBody, validationCanary) || strings.Contains(responseBody, "good-key") {
		t.Fatalf("validation response leaked request or upstream data: %s", responseBody)
	}

	var response struct {
		Valid           bool                       `json:"valid"`
		SuccessCount    int                        `json:"success_count"`
		KeyResults      []keyValidationResult      `json:"key_results"`
		EndpointResults []endpointValidationResult `json:"endpoint_results"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !response.Valid || response.SuccessCount != 1 {
		t.Fatalf("valid = %v, success_count = %d", response.Valid, response.SuccessCount)
	}
	if len(response.KeyResults) != 3 ||
		response.KeyResults[0].Status != "invalid" ||
		response.KeyResults[1].Status != "valid" ||
		response.KeyResults[2].Status != "skipped" {
		t.Fatalf("key_results = %#v", response.KeyResults)
	}
	if len(response.EndpointResults) != 2 ||
		response.EndpointResults[0].Status != "valid" ||
		response.EndpointResults[1].Status != "reachable" ||
		response.EndpointResults[1].ErrorCategory != "provider_unavailable" {
		t.Fatalf("endpoint_results = %#v", response.EndpointResults)
	}
}

func TestValidateKeyRejectsMissingTemporaryKey(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(
		http.MethodPost,
		"/api/v1/providers/custom/validate-key",
		bytes.NewBufferString(`{"protocol":"openai","endpoints":[{"id":"primary","base_url":"https://example.com/v1","enabled":true}]}`),
	)
	context.Request.Header.Set("Content-Type", "application/json")
	context.Params = gin.Params{{Key: "provider", Value: "custom"}}

	(&ProviderHandler{client: http.DefaultClient}).ValidateKey(context)

	if recorder.Code != http.StatusBadRequest || strings.Contains(recorder.Body.String(), validationCanary) {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
}

func TestValidationTransportErrorCategoryDistinguishesTimeout(t *testing.T) {
	if got := validationTransportErrorCategory(context.Background(), context.DeadlineExceeded); got != "timeout" {
		t.Fatalf("deadline category = %q", got)
	}
	if got := validationTransportErrorCategory(context.Background(), errors.New("offline")); got != "network_error" {
		t.Fatalf("network category = %q", got)
	}
}
