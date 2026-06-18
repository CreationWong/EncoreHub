package provider

// Protocol identifies which adapter implementation a profile maps to. New
// providers are almost always OpenAI-compatible; Anthropic is the one common
// exception (different auth header + request shape).
const (
	ProtocolOpenAI    = "openai"
	ProtocolAnthropic = "anthropic"
)

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
	// Enabled profiles are registered as adapters; disabled ones are kept in
	// the persisted list but not callable.
	Enabled bool `json:"enabled"`
	// Builtin profiles ship with the app — editable (base_url/models) but not
	// deletable, so the user can't lock themselves out of the default set.
	Builtin bool `json:"builtin"`
}
