// Package profiles converts persisted ProviderProfile records into live
// adapters and supplies the builtin default set. It lives in its own package
// (importing both the base provider package and the concrete adapters) to
// avoid an import cycle.
package profiles

import (
	"fmt"

	"github.com/encorehub/gateway/internal/provider"
	"github.com/encorehub/gateway/internal/provider/anthropic"
	"github.com/encorehub/gateway/internal/provider/openaicompat"
)

// Builtins returns the default provider set shipped with the app. These are
// marked Builtin (editable, not deletable) and Enabled.
func Builtins() []provider.ProviderProfile {
	return []provider.ProviderProfile{
		{
			ID:       "openai",
			Name:     "OpenAI",
			Protocol: provider.ProtocolOpenAI,
			BaseURL:  "", // SDK default (https://api.openai.com/v1)
			Models:   []string{"gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o1"},
			Enabled:  true,
			Builtin:  true,
		},
		{
			ID:       "anthropic",
			Name:     "Anthropic",
			Protocol: provider.ProtocolAnthropic,
			BaseURL:  "",
			Models:   []string{"claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"},
			Enabled:  true,
			Builtin:  true,
		},
		{
			ID:       "deepseek",
			Name:     "DeepSeek",
			Protocol: provider.ProtocolOpenAI,
			BaseURL:  "https://api.deepseek.com/v1",
			Models:   []string{"deepseek-chat", "deepseek-reasoner"},
			Enabled:  true,
			Builtin:  true,
		},
	}
}

func singleAdapter(p provider.ProviderProfile) (provider.Adapter, error) {
	switch p.Protocol {
	case provider.ProtocolOpenAI:
		return openaicompat.New(p), nil
	case provider.ProtocolAnthropic:
		return anthropic.NewFromProfile(p), nil
	default:
		return nil, fmt.Errorf("unknown protocol %q for provider %q", p.Protocol, p.ID)
	}
}

// Adapter builds one logical adapter from a profile. Profiles with multiple
// enabled endpoints are wrapped in a routed adapter; older BaseURL-only
// profiles continue to build exactly one concrete adapter.
func Adapter(p provider.ProviderProfile) (provider.Adapter, error) {
	var adapter provider.Adapter
	if len(p.Endpoints) == 0 {
		built, err := singleAdapter(p)
		if err != nil {
			return nil, err
		}
		adapter = built
	} else {
		adapters := make([]provider.Adapter, 0, len(p.Endpoints))
		for _, endpoint := range p.Endpoints {
			if !endpoint.Enabled {
				continue
			}
			endpointProfile := p
			endpointProfile.BaseURL = endpoint.BaseURL
			endpointProfile.Endpoints = nil
			built, err := singleAdapter(endpointProfile)
			if err != nil {
				return nil, err
			}
			adapters = append(adapters, built)
		}
		if len(adapters) == 1 {
			adapter = adapters[0]
		} else {
			built, err := provider.NewRoutedAdapter(p.ID, p.RoutingStrategy, adapters)
			if err != nil {
				return nil, err
			}
			adapter = built
		}
	}
	return provider.NewAPIKeyRoutedAdapter(p.ID, p.KeyRoutingStrategy, adapter)
}

// Adapters builds adapters for every enabled profile, skipping disabled ones.
// A profile with an unknown protocol is skipped with an error in the returned
// slice so the caller can log it without aborting the whole rebuild.
func Adapters(profiles []provider.ProviderProfile) ([]provider.Adapter, []error) {
	var adapters []provider.Adapter
	var errs []error
	for _, p := range profiles {
		if !p.Enabled {
			continue
		}
		a, err := Adapter(p)
		if err != nil {
			errs = append(errs, err)
			continue
		}
		adapters = append(adapters, a)
	}
	return adapters, errs
}
