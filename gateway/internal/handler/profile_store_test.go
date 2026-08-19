package handler

import (
	"testing"

	// Internal packages use EncoreHub's stable reverse-domain namespace.
	"com.0d000721.encorehub/gateway/internal/provider"
	"com.0d000721.encorehub/gateway/internal/provider/profiles"
)

func validProfile() provider.ProviderProfile {
	return provider.ProviderProfile{
		ID:       "custom",
		Name:     "Custom",
		Protocol: provider.ProtocolOpenAI,
		BaseURL:  "https://api.example.com/v1",
		Models:   []string{"model-a"},
		Enabled:  true,
	}
}

func TestValidateProfiles_OK(t *testing.T) {
	if err := validateProfiles([]provider.ProviderProfile{validProfile()}); err != nil {
		t.Fatalf("expected valid, got %v", err)
	}
}

func TestValidateProfiles_AcceptsOpenAIResponsesProtocol(t *testing.T) {
	p := validProfile()
	p.Protocol = provider.ProtocolOpenAIResponses
	if err := validateProfiles([]provider.ProviderProfile{p}); err != nil {
		t.Fatalf("expected Responses API profile to be valid, got %v", err)
	}
}

func TestValidateProfiles_RejectsEmptyID(t *testing.T) {
	p := validProfile()
	p.ID = "  "
	if err := validateProfiles([]provider.ProviderProfile{p}); err == nil {
		t.Fatal("expected empty-id rejection")
	}
}

func TestValidateProfiles_RejectsDuplicateID(t *testing.T) {
	p := validProfile()
	if err := validateProfiles([]provider.ProviderProfile{p, p}); err == nil {
		t.Fatal("expected duplicate-id rejection")
	}
}

func TestValidateProfiles_RejectsUnknownProtocol(t *testing.T) {
	p := validProfile()
	p.Protocol = "carrier-pigeon"
	if err := validateProfiles([]provider.ProviderProfile{p}); err == nil {
		t.Fatal("expected unknown-protocol rejection")
	}
}

func TestValidateProfiles_RequiresBaseURLForCustom(t *testing.T) {
	p := validProfile()
	p.BaseURL = ""
	if err := validateProfiles([]provider.ProviderProfile{p}); err == nil {
		t.Fatal("expected base_url rejection for non-builtin")
	}
}

func TestValidateProfiles_AcceptsMultipleSameProtocolEndpoints(t *testing.T) {
	p := validProfile()
	p.BaseURL = ""
	p.RoutingStrategy = provider.RoutingRoundRobin
	p.Endpoints = []provider.ProviderEndpoint{
		{ID: "primary", BaseURL: "https://primary.example.com/v1", Enabled: true},
		{ID: "backup", BaseURL: "https://backup.example.com/custom/v1", Enabled: true},
	}
	if err := validateProfiles([]provider.ProviderProfile{p}); err != nil {
		t.Fatalf("expected multi-endpoint profile to be valid, got %v", err)
	}
}

func TestValidateProfiles_RejectsUnsafeEndpointURL(t *testing.T) {
	p := validProfile()
	p.Endpoints = []provider.ProviderEndpoint{{
		ID: "primary", BaseURL: "https://user:secret@example.com/v1?token=secret", Enabled: true,
	}}
	if err := validateProfiles([]provider.ProviderProfile{p}); err == nil {
		t.Fatal("expected endpoint URL rejection")
	}
}

func TestValidateProfiles_RejectsDisabledEndpointSet(t *testing.T) {
	p := validProfile()
	p.Endpoints = []provider.ProviderEndpoint{{
		ID: "primary", BaseURL: "https://api.example.com/v1", Enabled: false,
	}}
	if err := validateProfiles([]provider.ProviderProfile{p}); err == nil {
		t.Fatal("expected at least one enabled endpoint")
	}
}

func TestValidateProfiles_AcceptsModelMetadata(t *testing.T) {
	p := validProfile()
	p.ModelConfigs = []provider.ProviderModelConfig{{
		ID: "model-a", Name: "Model A", Group: "General", Streaming: true, Currency: "USD", InputPrice: 1.5, ContextWindow: 128000,
	}}
	if err := validateProfiles([]provider.ProviderProfile{p}); err != nil {
		t.Fatalf("expected model metadata to be valid, got %v", err)
	}
}

func TestValidateProfiles_RejectsNegativeContextWindow(t *testing.T) {
	p := validProfile()
	p.ModelConfigs = []provider.ProviderModelConfig{{
		ID: "model-a", ContextWindow: -1,
	}}
	if err := validateProfiles([]provider.ProviderProfile{p}); err == nil {
		t.Fatal("expected negative context-window rejection")
	}
}

func TestValidateProfiles_AcceptsRichDiscoveredModelMetadata(t *testing.T) {
	p := validProfile()
	p.ModelConfigs = []provider.ProviderModelConfig{{
		ID:               "model-a",
		OwnedBy:          "openai",
		InputModalities:  []string{"text", "image"},
		APIEndpoints:     []string{"/v1/chat/completions"},
		DocumentationURL: "https://docs.example.com/model-a",
		MaxOutputTokens:  100000,
		Pricing: provider.ProviderModelPricing{
			"prompt": {{Value: 1.5, Unit: "perMTokens", Currency: "USD"}},
		},
	}}
	if err := validateProfiles([]provider.ProviderProfile{p}); err != nil {
		t.Fatalf("expected rich model metadata to be valid, got %v", err)
	}
}

func TestValidateProfiles_RejectsNegativeTieredPricing(t *testing.T) {
	p := validProfile()
	p.ModelConfigs = []provider.ProviderModelConfig{{
		ID: "model-a",
		Pricing: provider.ProviderModelPricing{
			"prompt": {{Value: -1}},
		},
	}}
	if err := validateProfiles([]provider.ProviderProfile{p}); err == nil {
		t.Fatal("expected negative tiered pricing rejection")
	}
}

func TestValidateProfiles_RejectsEmbeddingModelOnNonOpenAIProtocol(t *testing.T) {
	p := validProfile()
	p.Protocol = provider.ProtocolAnthropic
	p.ModelConfigs = []provider.ProviderModelConfig{{
		ID: "model-a", Type: provider.ModelTypeEmbedding,
	}}
	if err := validateProfiles([]provider.ProviderProfile{p}); err == nil {
		t.Fatal("expected Anthropic embedding model rejection")
	}
}

func TestValidateProfiles_RejectsUnknownAPIKeyRoutingStrategy(t *testing.T) {
	p := validProfile()
	p.KeyRoutingStrategy = "random"
	if err := validateProfiles([]provider.ProviderProfile{p}); err == nil {
		t.Fatal("expected unknown API key routing strategy rejection")
	}
}

func TestValidateProfiles_AllowsEmptyBaseURLForBuiltinOpenAI(t *testing.T) {
	p := validProfile()
	p.ID = "openai"
	p.BaseURL = ""
	p.Builtin = true
	if err := validateProfiles([]provider.ProviderProfile{p}); err != nil {
		t.Fatalf("builtin openai may omit base_url, got %v", err)
	}
}

func TestValidateProfiles_AllowsEmptyBaseURLForBuiltinAnthropic(t *testing.T) {
	// Regression: the Anthropic builtin ships with an empty base_url (its
	// adapter falls back to api.anthropic.com). Saving it must not be rejected.
	p := validProfile()
	p.ID = "anthropic"
	p.Protocol = provider.ProtocolAnthropic
	p.BaseURL = ""
	p.Builtin = true
	if err := validateProfiles([]provider.ProviderProfile{p}); err != nil {
		t.Fatalf("builtin anthropic may omit base_url, got %v", err)
	}
}

func TestValidateProfiles_ShippedBuiltinsAreValid(t *testing.T) {
	// The default provider set must always pass validation — otherwise saving
	// any edit (which re-validates the whole list) fails on the builtins.
	if err := validateProfiles(profiles.Builtins()); err != nil {
		t.Fatalf("shipped builtins must validate, got %v", err)
	}
}

func TestValidateProfiles_RequiresAtLeastOneModel(t *testing.T) {
	p := validProfile()
	p.Models = nil
	if err := validateProfiles([]provider.ProviderProfile{p}); err == nil {
		t.Fatal("expected model rejection")
	}
}

func TestCheckBuiltinsPresent_BlocksBuiltinDeletion(t *testing.T) {
	s := &ProfileStore{
		profiles: []provider.ProviderProfile{
			{ID: "openai", Builtin: true},
			{ID: "custom", Builtin: false},
		},
	}
	// Dropping the custom one is fine.
	if err := s.checkBuiltinsPresent([]provider.ProviderProfile{{ID: "openai", Builtin: true}}); err != nil {
		t.Fatalf("dropping non-builtin should be allowed, got %v", err)
	}
	// Dropping the builtin one is not.
	if err := s.checkBuiltinsPresent([]provider.ProviderProfile{{ID: "custom"}}); err == nil {
		t.Fatal("expected builtin-deletion rejection")
	}
}

func TestSortedProfiles_BuiltinsFirstThenName(t *testing.T) {
	in := []provider.ProviderProfile{
		{ID: "z-custom", Name: "Zeta", Builtin: false},
		{ID: "a-custom", Name: "Alpha", Builtin: false},
		{ID: "openai", Name: "OpenAI", Builtin: true},
	}
	out := sortedProfiles(in)
	if !out[0].Builtin {
		t.Fatalf("expected builtin first, got %q", out[0].ID)
	}
	if out[1].Name != "Alpha" || out[2].Name != "Zeta" {
		t.Fatalf("non-builtins should sort by name: %q, %q", out[1].Name, out[2].Name)
	}
}
