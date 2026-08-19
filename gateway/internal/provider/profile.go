package provider

import (
	"net/url"
	"strings"
)

// Protocol identifies which adapter implementation a profile maps to. New
// providers are almost always OpenAI-compatible; Anthropic is the one common
// exception (different auth header + request shape).
const (
	ProtocolOpenAI          = "openai"
	ProtocolOpenAIResponses = "openai-responses"
	ProtocolAnthropic       = "anthropic"

	RoutingFailover   = "failover"
	RoutingRoundRobin = "round_robin"

	ModelTypeChat      = "chat"
	ModelTypeEmbedding = "embedding"
)

// ResolveAPIBaseURL expands a domain-only gateway endpoint to the namespace
// used by the selected wire protocol. Existing API paths remain untouched.
func ResolveAPIBaseURL(protocol, baseURL string) string {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	parsed, err := url.Parse(base)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return base
	}
	segments := strings.FieldsFunc(parsed.Path, func(r rune) bool { return r == '/' })
	for _, segment := range segments {
		if segment == "v1" {
			return base
		}
	}
	// Responses uses the official OpenAI /v1 namespace but has a different
	// request shape from Chat Completions. It must not become /openai-responses/v1.
	pathProtocol := protocol
	if protocol == ProtocolOpenAIResponses {
		pathProtocol = ProtocolOpenAI
	}
	if len(segments) > 0 && segments[len(segments)-1] == pathProtocol {
		return base + "/v1"
	}
	return base + "/" + pathProtocol + "/v1"
}

// ProviderEndpoint is one ordered base URL for a provider. Every endpoint in
// a profile uses the profile's protocol and API key; mixing different
// suppliers inside one profile is intentionally unsupported.
type ProviderEndpoint struct {
	ID      string `json:"id"`
	Name    string `json:"name,omitempty"`
	BaseURL string `json:"base_url"`
	Enabled bool   `json:"enabled"`
}

// ProviderPriceCondition describes one numeric boundary attached to a pricing
// tier, such as prompt_tokens >= 200 kTokens.
type ProviderPriceCondition struct {
	Unit string   `json:"unit,omitempty"`
	GTE  *float64 `json:"gte,omitempty"`
	LT   *float64 `json:"lt,omitempty"`
}

// ProviderModelPrice preserves provider-native tiered pricing without falling
// back to untyped JSON in the externally serialized profile.
type ProviderModelPrice struct {
	Value      float64                           `json:"value"`
	Unit       string                            `json:"unit,omitempty"`
	Currency   string                            `json:"currency,omitempty"`
	Conditions map[string]ProviderPriceCondition `json:"conditions,omitempty"`
}

type ProviderModelPricing map[string][]ProviderModelPrice

// ProviderModelConfig stores optional presentation and capability metadata.
// Models remains the runtime source of truth so older clients and persisted
// profiles continue to work unchanged.
type ProviderModelConfig struct {
	// ID is the exact model value sent in provider API requests.
	ID string `json:"id"`
	// Name is an optional local display note/alias and is never sent upstream.
	Name             string               `json:"name,omitempty"`
	Description      string               `json:"description,omitempty"`
	Group            string               `json:"group,omitempty"`
	OwnedBy          string               `json:"owned_by,omitempty"`
	Capabilities     []string             `json:"capabilities,omitempty"`
	InputModalities  []string             `json:"input_modalities,omitempty"`
	OutputModalities []string             `json:"output_modalities,omitempty"`
	APIEndpoints     []string             `json:"api_endpoints,omitempty"`
	DocumentationURL string               `json:"documentation_url,omitempty"`
	SourceURL        string               `json:"source_url,omitempty"`
	Pricing          ProviderModelPricing `json:"pricing,omitempty"`
	// Type separates utility models from models that may participate in chat.
	// Empty remains equivalent to chat for profiles saved by older clients.
	Type            string  `json:"type,omitempty"`
	Dimensions      int     `json:"dimensions,omitempty"`
	ContextWindow   int     `json:"context_window,omitempty"`
	MaxOutputTokens int     `json:"max_output_tokens,omitempty"`
	Streaming       bool    `json:"streaming"`
	Currency        string  `json:"currency,omitempty"`
	InputPrice      float64 `json:"input_price,omitempty"`
	OutputPrice     float64 `json:"output_price,omitempty"`
}

// ModelType returns the configured purpose for a model. The legacy embedding
// capability is recognised so old profiles remain isolated from chat.
func (p ProviderProfile) ModelType(modelID string) string {
	for _, config := range p.ModelConfigs {
		if config.ID != modelID {
			continue
		}
		if config.Type == ModelTypeEmbedding {
			return ModelTypeEmbedding
		}
		for _, capability := range config.Capabilities {
			if capability == ModelTypeEmbedding {
				return ModelTypeEmbedding
			}
		}
		return ModelTypeChat
	}
	return ModelTypeChat
}

// ModelConfig returns presentation/runtime metadata for one configured model.
func (p ProviderProfile) ModelConfig(modelID string) (ProviderModelConfig, bool) {
	for _, config := range p.ModelConfigs {
		if config.ID == modelID {
			return config, true
		}
	}
	return ProviderModelConfig{}, false
}

// ProviderProfile is the persisted, user-editable definition of an AI provider.
// Profiles are stored as JSON in the engine `config` table (key
// `provider_profiles`) and turned into live adapters at boot and on edit.
//
// SECURITY: a profile never contains an API key. AuthHeader is only the *name*
// of the header the provider expects; the secret itself is supplied per-request
// by the client via X-Provider-Key and is never persisted.
type ProviderProfile struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Protocol string   `json:"protocol"` // ProtocolOpenAI | ProtocolOpenAIResponses | ProtocolAnthropic
	BaseURL  string   `json:"base_url"`
	Models   []string `json:"models"`
	// Endpoints supersedes BaseURL when present. Order is significant in
	// failover mode; BaseURL remains populated for backward compatibility.
	Endpoints       []ProviderEndpoint `json:"endpoints,omitempty"`
	RoutingStrategy string             `json:"routing_strategy,omitempty"`
	// KeyRoutingStrategy controls how the separately stored API-key pool is
	// selected. Key values never enter this profile.
	KeyRoutingStrategy string                `json:"key_routing_strategy,omitempty"`
	ModelConfigs       []ProviderModelConfig `json:"model_configs,omitempty"`
	// Enabled profiles are registered as adapters; disabled ones are kept in
	// the persisted list but not callable.
	Enabled bool `json:"enabled"`
	// Builtin profiles ship with the app — editable (base_url/models) but not
	// deletable, so the user can't lock themselves out of the default set.
	Builtin bool `json:"builtin"`
}
