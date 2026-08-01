package handler

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"

	// Internal packages use EncoreHub's stable reverse-domain namespace.
	"com.0d000721.encorehub/gateway/internal/provider"
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
	enabledCount := 0
	var wait sync.WaitGroup
	for index, endpoint := range request.Endpoints {
		results[index].EndpointID = endpoint.ID
		if !endpoint.Enabled {
			results[index].Status = "skipped"
			continue
		}
		enabledCount++
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
	if enabledCount == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "at least one endpoint must be enabled"})
		return
	}
	wait.Wait()

	seen := make(map[string]struct{})
	models := make([]provider.ModelInfo, 0)
	successCount := 0
	unsupportedCount := 0
	for _, result := range results {
		if result.Status == "ok" {
			successCount++
		}
		if result.ErrorCategory == "unsupported_endpoint" {
			unsupportedCount++
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
		"discovery_supported": unsupportedCount < enabledCount,
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
	request, err := newProviderModelsRequest(ctx, protocol, baseURL, apiKey)
	if err != nil {
		return nil, "invalid_url"
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
		var metadata provider.ModelInfo
		switch value := entry.(type) {
		case string:
			id = strings.TrimSpace(value)
		case map[string]any:
			id = firstModelString(value, "id", "model", "name")
			info, _ := value["info"].(map[string]any)
			name = firstNonEmpty(
				firstModelString(value, "display_name", "displayName", "name"),
				firstModelString(info, "name"),
			)
			metadata = discoveredModelMetadata(value)
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
		metadata.ID = id
		metadata.Name = name
		metadata.Provider = providerID
		models = append(models, metadata)
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

func discoveredModelMetadata(object map[string]any) provider.ModelInfo {
	info, _ := object["info"].(map[string]any)
	capabilities := modelStringSlice(object["features"])
	if len(capabilities) == 0 {
		capabilities = modelCapabilities(object["capabilities"])
	}
	return provider.ModelInfo{
		OwnedBy: firstNonEmpty(
			firstModelString(object, "owned_by", "ownedBy", "provider", "developer"),
			firstModelString(info, "developer"),
		),
		Description: firstNonEmpty(
			firstModelString(object, "description"),
			firstModelString(info, "description"),
		),
		Capabilities: capabilities,
		ContextLimit: firstPositiveInt(
			modelNumber(object["context_limit"]),
			modelNumber(object["context_length"]),
			modelNumber(object["contextWindow"]),
			modelNumber(info["contextLength"]),
		),
		MaxOutputTokens: firstPositiveInt(
			modelNumber(object["max_output_tokens"]),
			modelNumber(object["maxTokens"]),
			modelNumber(info["maxTokens"]),
		),
		InputModalities:  modelStringSlice(object["input_modalities"]),
		OutputModalities: modelStringSlice(object["output_modalities"]),
		APIEndpoints: firstStringSlice(
			modelStringSlice(object["api_endpoints"]),
			modelStringSlice(object["endpoints"]),
		),
		DocumentationURL: firstNonEmpty(
			firstModelString(object, "documentation_url", "docs_url"),
			firstModelString(info, "docs_url", "documentation_url"),
		),
		SourceURL: firstNonEmpty(
			firstModelString(object, "source_url", "url"),
			firstModelString(info, "url", "source_url"),
		),
		Pricing: modelPricing(firstNonNil(object["pricings"], object["pricing"])),
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func firstNonNil(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func modelNumber(value any) int {
	switch number := value.(type) {
	case float64:
		return int(number)
	case int:
		return number
	case json.Number:
		parsed, _ := number.Int64()
		return int(parsed)
	}
	return 0
}

func firstPositiveInt(values ...int) int {
	for _, value := range values {
		if value > 0 {
			return value
		}
	}
	return 0
}

func modelStringSlice(value any) []string {
	list, ok := value.([]any)
	if !ok {
		return nil
	}
	values := make([]string, 0, len(list))
	for _, item := range list {
		if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
			values = append(values, strings.TrimSpace(text))
		}
	}
	return values
}

func firstStringSlice(values ...[]string) []string {
	for _, value := range values {
		if len(value) > 0 {
			return value
		}
	}
	return nil
}

func modelCapabilities(value any) []string {
	if direct := modelStringSlice(value); len(direct) > 0 {
		return direct
	}
	object, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	capabilities := make([]string, 0, len(object))
	for name, enabled := range object {
		if state, ok := enabled.(bool); ok && state {
			capabilities = append(capabilities, name)
		}
	}
	return capabilities
}

func modelPricing(value any) provider.ProviderModelPricing {
	object, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	pricing := make(provider.ProviderModelPricing)
	for kind, rawTiers := range object {
		list, ok := rawTiers.([]any)
		if !ok {
			list = []any{rawTiers}
		}
		tiers := make([]provider.ProviderModelPrice, 0, len(list))
		for _, rawTier := range list {
			tier, ok := rawTier.(map[string]any)
			if !ok {
				continue
			}
			value, ok := tier["value"].(float64)
			if !ok {
				continue
			}
			tiers = append(tiers, provider.ProviderModelPrice{
				Value:      value,
				Unit:       firstModelString(tier, "unit"),
				Currency:   firstModelString(tier, "currency"),
				Conditions: modelPriceConditions(tier["conditions"]),
			})
		}
		if len(tiers) > 0 {
			pricing[kind] = tiers
		}
	}
	if len(pricing) == 0 {
		return nil
	}
	return pricing
}

func modelPriceConditions(value any) map[string]provider.ProviderPriceCondition {
	object, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	conditions := make(map[string]provider.ProviderPriceCondition)
	for name, rawCondition := range object {
		condition, ok := rawCondition.(map[string]any)
		if !ok {
			continue
		}
		conditions[name] = provider.ProviderPriceCondition{
			Unit: firstModelString(condition, "unit"),
			GTE:  optionalFloat(condition["gte"]),
			LT:   optionalFloat(condition["lt"]),
		}
	}
	if len(conditions) == 0 {
		return nil
	}
	return conditions
}

func optionalFloat(value any) *float64 {
	number, ok := value.(float64)
	if !ok {
		return nil
	}
	return &number
}
