package provider

// Protocol identifies which adapter implementation a profile maps to. New
// providers are almost always OpenAI-compatible; Anthropic is the one common
// exception (different auth header + request shape).
const (
	ProtocolOpenAI    = "openai"
	ProtocolAnthropic = "anthropic"

	RoutingFailover   = "failover"
	RoutingRoundRobin = "round_robin"

	ModelTypeChat      = "chat"
	ModelTypeEmbedding = "embedding"
)

// ProviderEndpoint is one ordered base URL for a provider. Every endpoint in
// a profile uses the profile's protocol and API key; mixing different
// suppliers inside one profile is intentionally unsupported.
type ProviderEndpoint struct {
	ID      string `json:"id"`
	Name    string `json:"name,omitempty"`
	BaseURL string `json:"base_url"`
	Enabled bool   `json:"enabled"`
}

// ProviderModelConfig stores optional presentation and capability metadata.
// Models remains the runtime source of truth so older clients and persisted
// profiles continue to work unchanged.
type ProviderModelConfig struct {
	// ID is the exact model value sent in provider API requests.
	ID string `json:"id"`
	// Name is an optional local display note/alias and is never sent upstream.
	Name         string   `json:"name,omitempty"`
	Group        string   `json:"group,omitempty"`
	Capabilities []string `json:"capabilities,omitempty"`
	// Type separates utility models from models that may participate in chat.
	// Empty remains equivalent to chat for profiles saved by older clients.
	Type        string  `json:"type,omitempty"`
	Dimensions  int     `json:"dimensions,omitempty"`
	Streaming   bool    `json:"streaming"`
	Currency    string  `json:"currency,omitempty"`
	InputPrice  float64 `json:"input_price,omitempty"`
	OutputPrice float64 `json:"output_price,omitempty"`
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
	Protocol string   `json:"protocol"` // ProtocolOpenAI | ProtocolAnthropic
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
