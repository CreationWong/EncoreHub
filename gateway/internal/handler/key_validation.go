package handler

import (
	"context"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/encorehub/gateway/internal/provider"
	"github.com/gin-gonic/gin"
)

const keyValidationTimeout = 20 * time.Second

type validateKeyRequest struct {
	Protocol  string                      `json:"protocol"`
	Endpoints []provider.ProviderEndpoint `json:"endpoints"`
}

type keyValidationResult struct {
	KeyID         string `json:"key_id"`
	Status        string `json:"status"`
	EndpointID    string `json:"endpoint_id,omitempty"`
	ErrorCategory string `json:"error_category,omitempty"`
}

type endpointValidationResult struct {
	EndpointID    string `json:"endpoint_id"`
	Status        string `json:"status"`
	LatencyMS     int64  `json:"latency_ms"`
	ErrorCategory string `json:"error_category,omitempty"`
}

type validationAttempt struct {
	endpointID string
	valid      bool
	reachable  bool
	latencyMS  int64
	category   string
}

type keyValidationRun struct {
	result   keyValidationResult
	attempts []validationAttempt
}

// ValidateKey probes request-local credentials and draft endpoints without
// reading or writing provider profiles or secrets. Responses contain only
// caller-supplied opaque IDs and safe error categories.
func (h *ProviderHandler) ValidateKey(c *gin.Context) {
	providerID := strings.TrimSpace(c.Param("provider"))
	entries, err := provider.ParseAPIKeyPool(c.GetHeader("X-Provider-Key"))
	if err != nil || len(entries) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid API key pool"})
		return
	}

	var request validateKeyRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid validation request"})
		return
	}
	if request.Protocol != provider.ProtocolOpenAI && request.Protocol != provider.ProtocolAnthropic {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported API format"})
		return
	}
	if len(request.Endpoints) == 0 || len(request.Endpoints) > 16 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "between 1 and 16 endpoints are required"})
		return
	}

	seenEndpointIDs := make(map[string]struct{}, len(request.Endpoints))
	enabledEndpoints := make([]provider.ProviderEndpoint, 0, len(request.Endpoints))
	for _, endpoint := range request.Endpoints {
		endpoint.ID = strings.TrimSpace(endpoint.ID)
		if endpoint.ID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "endpoint IDs are required"})
			return
		}
		if _, duplicate := seenEndpointIDs[endpoint.ID]; duplicate {
			c.JSON(http.StatusBadRequest, gin.H{"error": "endpoint IDs must be unique"})
			return
		}
		seenEndpointIDs[endpoint.ID] = struct{}{}
		if !endpoint.Enabled {
			continue
		}
		if err := validateProviderBaseURL(endpoint.BaseURL); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid endpoint URL"})
			return
		}
		enabledEndpoints = append(enabledEndpoints, endpoint)
	}
	if len(enabledEndpoints) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "at least one endpoint must be enabled"})
		return
	}

	probeContext, cancel := context.WithTimeout(c.Request.Context(), keyValidationTimeout)
	defer cancel()

	runs := make([]keyValidationRun, len(entries))
	var wait sync.WaitGroup
	for index, entry := range entries {
		if !entry.Enabled {
			runs[index].result = keyValidationResult{KeyID: entry.ID, Status: "skipped"}
			continue
		}
		wait.Add(1)
		go func(index int, entry provider.APIKeyPoolEntry) {
			defer wait.Done()
			runs[index] = h.validateKeyAcrossEndpoints(
				probeContext,
				request.Protocol,
				entry,
				enabledEndpoints,
			)
		}(index, entry)
	}
	wait.Wait()

	endpointResults := make([]endpointValidationResult, len(request.Endpoints))
	endpointIndexes := make(map[string]int, len(request.Endpoints))
	for index, endpoint := range request.Endpoints {
		endpointIndexes[endpoint.ID] = index
		endpointResults[index].EndpointID = endpoint.ID
		if !endpoint.Enabled {
			endpointResults[index].Status = "skipped"
		}
	}
	for _, run := range runs {
		for _, attempt := range run.attempts {
			index := endpointIndexes[attempt.endpointID]
			mergeEndpointValidationResult(&endpointResults[index], attempt)
		}
	}

	// A key usually succeeds on the first endpoint. Probe any remaining draft
	// endpoints once with a known-good key (or the first enabled key) so every
	// endpoint still receives an independent connection-health result.
	referenceKey := ""
	for index, run := range runs {
		if run.result.Status == "valid" {
			referenceKey = entries[index].Value
			break
		}
	}
	if referenceKey == "" {
		for _, entry := range entries {
			if entry.Enabled {
				referenceKey = entry.Value
				break
			}
		}
	}
	for _, endpoint := range enabledEndpoints {
		index := endpointIndexes[endpoint.ID]
		if endpointResults[index].Status != "" {
			continue
		}
		attempt := h.validateEndpointWithKey(
			probeContext,
			request.Protocol,
			endpoint,
			referenceKey,
		)
		mergeEndpointValidationResult(&endpointResults[index], attempt)
	}
	for index := range endpointResults {
		if endpointResults[index].Status == "" {
			endpointResults[index].Status = "unreachable"
			endpointResults[index].ErrorCategory = "network_error"
		}
	}

	keyResults := make([]keyValidationResult, len(runs))
	validCount := 0
	for index, run := range runs {
		keyResults[index] = run.result
		if run.result.Status == "valid" {
			validCount++
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"provider":         providerID,
		"valid":            validCount > 0,
		"success_count":    validCount,
		"key_results":      keyResults,
		"endpoint_results": endpointResults,
	})
}

func (h *ProviderHandler) validateKeyAcrossEndpoints(
	ctx context.Context,
	protocol string,
	entry provider.APIKeyPoolEntry,
	endpoints []provider.ProviderEndpoint,
) keyValidationRun {
	run := keyValidationRun{
		result: keyValidationResult{KeyID: entry.ID, Status: "error"},
	}
	for _, endpoint := range endpoints {
		attempt := h.validateEndpointWithKey(ctx, protocol, endpoint, entry.Value)
		run.attempts = append(run.attempts, attempt)
		run.result.EndpointID = endpoint.ID
		run.result.ErrorCategory = attempt.category
		if attempt.valid {
			run.result.Status = "valid"
			run.result.ErrorCategory = ""
			return run
		}
		if attempt.category == "authentication_failed" {
			run.result.Status = "invalid"
			return run
		}
		if ctx.Err() != nil {
			return run
		}
	}
	return run
}

func (h *ProviderHandler) validateEndpointWithKey(
	ctx context.Context,
	protocol string,
	endpoint provider.ProviderEndpoint,
	apiKey string,
) validationAttempt {
	attempt := validationAttempt{endpointID: endpoint.ID}
	request, err := newProviderModelsRequest(ctx, protocol, endpoint.BaseURL, apiKey)
	if err != nil {
		attempt.category = "invalid_url"
		return attempt
	}

	started := time.Now()
	response, err := h.client.Do(request)
	attempt.latencyMS = time.Since(started).Milliseconds()
	if err != nil {
		attempt.category = "network_error"
		return attempt
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4<<10))
	attempt.reachable = true
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		attempt.valid = true
		return attempt
	}
	attempt.category = discoveryHTTPErrorCategory(response.StatusCode)
	return attempt
}

func mergeEndpointValidationResult(
	result *endpointValidationResult,
	attempt validationAttempt,
) {
	status := "unreachable"
	if attempt.valid {
		status = "valid"
	} else if attempt.reachable {
		status = "reachable"
	}
	if endpointValidationRank(status) < endpointValidationRank(result.Status) {
		return
	}
	result.Status = status
	result.LatencyMS = attempt.latencyMS
	result.ErrorCategory = attempt.category
}

func endpointValidationRank(status string) int {
	switch status {
	case "valid":
		return 3
	case "reachable":
		return 2
	case "unreachable":
		return 1
	default:
		return 0
	}
}

func newProviderModelsRequest(
	ctx context.Context,
	protocol string,
	baseURL string,
	apiKey string,
) (*http.Request, error) {
	endpoint := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if !strings.HasSuffix(endpoint, "/models") {
		endpoint += "/models"
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/json")
	if protocol == provider.ProtocolAnthropic {
		request.Header.Set("x-api-key", apiKey)
		request.Header.Set("anthropic-version", "2023-06-01")
	} else {
		request.Header.Set("Authorization", "Bearer "+apiKey)
	}
	return request, nil
}
