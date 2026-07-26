package handler

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"

	"github.com/encorehub/gateway/internal/provider"
	"github.com/gin-gonic/gin"
)

const maxModelDiscoveryBody = 2 << 20

type discoverModelsRequest struct {
	Protocol           string                      `json:"protocol"`
	KeyRoutingStrategy string                      `json:"key_routing_strategy"`
	Endpoints          []provider.ProviderEndpoint `json:"endpoints"`
}

type endpointDiscoveryResult struct {
	EndpointID    string `json:"endpoint_id"`
	Status        string `json:"status"`
	ModelCount    int    `json:"model_count"`
	ErrorCategory string `json:"error_category,omitempty"`
	models        []provider.ModelInfo
}

// DiscoverModels probes draft endpoint settings without persisting the
// profile or key. All endpoint failures are returned as structured categories
// so no remote response body or full URL reaches logs or UI error strings.
func (h *ProviderHandler) DiscoverModels(c *gin.Context) {
	providerID := strings.TrimSpace(c.Param("provider"))
	rawAPIKeys := c.GetHeader("X-Provider-Key")
	if rawAPIKeys == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "API key is required"})
		return
	}
	apiKeys, err := provider.ParseAPIKeys(rawAPIKeys)
	if err != nil || len(apiKeys) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid API key pool"})
		return
	}

	var request discoverModelsRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid discovery request"})
		return
	}
	if request.Protocol != provider.ProtocolOpenAI && request.Protocol != provider.ProtocolAnthropic {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported API format"})
		return
	}
	if request.KeyRoutingStrategy == "" {
		request.KeyRoutingStrategy = provider.RoutingFailover
	}
	if request.KeyRoutingStrategy != provider.RoutingFailover &&
		request.KeyRoutingStrategy != provider.RoutingRoundRobin {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported API key routing strategy"})
		return
	}
	if len(request.Endpoints) == 0 || len(request.Endpoints) > 16 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "between 1 and 16 endpoints are required"})
		return
	}

	if request.KeyRoutingStrategy == provider.RoutingRoundRobin && len(apiKeys) > 1 {
		start := int((h.discoveryKeyNext.Add(1) - 1) % uint64(len(apiKeys)))
		ordered := make([]string, len(apiKeys))
		for index := range ordered {
			ordered[index] = apiKeys[(start+index)%len(apiKeys)]
		}
		apiKeys = ordered
	}

	results := make([]endpointDiscoveryResult, len(request.Endpoints))
	var wait sync.WaitGroup
	for index, endpoint := range request.Endpoints {
		results[index].EndpointID = endpoint.ID
		if !endpoint.Enabled {
			results[index].Status = "skipped"
			continue
		}
		if err := validateProviderBaseURL(endpoint.BaseURL); err != nil {
			results[index].Status = "error"
			results[index].ErrorCategory = "invalid_url"
			continue
		}
		wait.Add(1)
		go func(index int, endpoint provider.ProviderEndpoint) {
			defer wait.Done()
			models, category := h.discoverEndpointModels(
				c.Request.Context(),
				providerID,
				request.Protocol,
				endpoint.BaseURL,
				apiKeys,
			)
			if category != "" {
				results[index].Status = "error"
				results[index].ErrorCategory = category
				return
			}
			results[index].Status = "ok"
			results[index].ModelCount = len(models)
			results[index].models = models
		}(index, endpoint)
	}
	wait.Wait()

	seen := make(map[string]struct{})
	models := make([]provider.ModelInfo, 0)
	successCount := 0
	for _, result := range results {
		if result.Status == "ok" {
			successCount++
		}
		for _, model := range result.models {
			if _, exists := seen[model.ID]; exists {
				continue
			}
			seen[model.ID] = struct{}{}
			models = append(models, model)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"provider":            providerID,
		"discovery_supported": true,
		"success_count":       successCount,
		"models":              models,
		"endpoint_results":    results,
	})
}

func (h *ProviderHandler) discoverEndpointModels(
	ctx context.Context,
	providerID string,
	protocol string,
	baseURL string,
	apiKeys []string,
) ([]provider.ModelInfo, string) {
	lastCategory := "authentication_failed"
	for _, apiKey := range apiKeys {
		models, category := h.discoverEndpointModelsWithKey(
			ctx,
			providerID,
			protocol,
			baseURL,
			apiKey,
		)
		if category == "" {
			return models, ""
		}
		lastCategory = category
		if ctx.Err() != nil {
			return nil, "network_error"
		}
	}
	return nil, lastCategory
}

func (h *ProviderHandler) discoverEndpointModelsWithKey(
	ctx context.Context,
	providerID string,
	protocol string,
	baseURL string,
	apiKey string,
) ([]provider.ModelInfo, string) {
	endpoint := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if !strings.HasSuffix(endpoint, "/models") {
		endpoint += "/models"
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, "invalid_url"
	}
	request.Header.Set("Accept", "application/json")
	if protocol == provider.ProtocolAnthropic {
		request.Header.Set("x-api-key", apiKey)
		request.Header.Set("anthropic-version", "2023-06-01")
	} else {
		request.Header.Set("Authorization", "Bearer "+apiKey)
	}

	response, err := h.client.Do(request)
	if err != nil {
		return nil, "network_error"
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, discoveryHTTPErrorCategory(response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxModelDiscoveryBody))
	if err != nil {
		return nil, "invalid_response"
	}
	models, ok := parseDiscoveredModels(body, providerID)
	if !ok {
		return nil, "unsupported_response"
	}
	if len(models) == 0 {
		return nil, "empty_response"
	}
	return models, ""
}

func discoveryHTTPErrorCategory(status int) string {
	switch {
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return "authentication_failed"
	case status == http.StatusTooManyRequests:
		return "rate_limited"
	case status == http.StatusNotFound || status == http.StatusMethodNotAllowed:
		return "unsupported_endpoint"
	case status >= 500:
		return "provider_unavailable"
	default:
		return "request_rejected"
	}
}

func parseDiscoveredModels(body []byte, providerID string) ([]provider.ModelInfo, bool) {
	var root any
	if err := json.Unmarshal(body, &root); err != nil {
		return nil, false
	}
	entries := root
	if object, ok := root.(map[string]any); ok {
		if data, exists := object["data"]; exists {
			entries = data
		} else if models, exists := object["models"]; exists {
			entries = models
		} else {
			return nil, false
		}
	}
	list, ok := entries.([]any)
	if !ok {
		return nil, false
	}

	seen := make(map[string]struct{}, len(list))
	models := make([]provider.ModelInfo, 0, len(list))
	for _, entry := range list {
		id := ""
		name := ""
		switch value := entry.(type) {
		case string:
			id = strings.TrimSpace(value)
		case map[string]any:
			id = firstModelString(value, "id", "model", "name")
			name = firstModelString(value, "display_name", "displayName", "name")
		}
		if id == "" {
			continue
		}
		if _, duplicate := seen[id]; duplicate {
			continue
		}
		seen[id] = struct{}{}
		if name == "" {
			name = id
		}
		models = append(models, provider.ModelInfo{ID: id, Name: name, Provider: providerID})
	}
	return models, true
}

func firstModelString(object map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := object[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
