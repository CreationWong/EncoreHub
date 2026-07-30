package handler

import (
	"context"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"sync"

	// Internal packages use EncoreHub's stable reverse-domain namespace.
	"com.0d000721.encorehub/gateway/internal/engine"
	"com.0d000721.encorehub/gateway/internal/provider"
	"com.0d000721.encorehub/gateway/internal/provider/profiles"
	"github.com/rs/zerolog/log"
)

// profilesConfigKey is the engine config key under which the provider profile
// list is persisted.
const profilesConfigKey = "provider_profiles"

// ProfileStore owns the canonical provider-profile list. It persists profiles
// to the engine and keeps the live adapter Registry in sync. All mutations go
// through Save so persistence and registry rebuild stay atomic together.
type ProfileStore struct {
	engine   *engine.Client
	registry *provider.Registry

	mu       sync.RWMutex
	profiles []provider.ProviderProfile
}

// NewProfileStore creates a store backed by the given engine client and
// registry. Call Load once at startup to populate both.
func NewProfileStore(eng *engine.Client, reg *provider.Registry) *ProfileStore {
	return &ProfileStore{engine: eng, registry: reg}
}

// Load fetches persisted profiles from the engine and applies them to the
// registry. If none are stored yet (fresh install) the builtin defaults are
// used and persisted. Returns an error only if the registry could not be
// populated at all; engine read/write failures fall back to builtins so the
// gateway still serves the default providers.
func (s *ProfileStore) Load(ctx context.Context) error {
	var stored []provider.ProviderProfile
	if err := s.engine.GetConfig(ctx, profilesConfigKey, &stored); err != nil {
		// Engine unreachable or key unreadable — degrade to builtins so chat
		// still works against the default providers.
		s.apply(profiles.Builtins())
		return fmt.Errorf("load provider profiles from engine: %w", err)
	}

	if len(stored) == 0 {
		// Fresh install: seed builtins and persist them.
		builtins := profiles.Builtins()
		s.apply(builtins)
		if err := s.engine.SetConfig(ctx, profilesConfigKey, builtins); err != nil {
			return fmt.Errorf("seed builtin profiles: %w", err)
		}
		return nil
	}

	s.apply(stored)
	return nil
}

// Profiles returns a copy of the current profile list.
func (s *ProfileStore) Profiles() []provider.ProviderProfile {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]provider.ProviderProfile, len(s.profiles))
	copy(out, s.profiles)
	return out
}

// Save validates, persists, and applies a new profile list. Builtin profiles
// that exist now may not be removed (they can be edited, but the set of
// builtin IDs must remain present).
func (s *ProfileStore) Save(ctx context.Context, next []provider.ProviderProfile) error {
	if err := validateProfiles(next); err != nil {
		return err
	}
	if err := s.checkBuiltinsPresent(next); err != nil {
		return err
	}
	if err := s.engine.SetConfig(ctx, profilesConfigKey, next); err != nil {
		return fmt.Errorf("persist provider profiles: %w", err)
	}
	s.apply(next)
	return nil
}

// apply swaps the registry contents and caches the profile list.
func (s *ProfileStore) apply(list []provider.ProviderProfile) {
	adapters, errs := profiles.Adapters(list)
	for _, e := range errs {
		// Bad protocol on one profile shouldn't sink the rest.
		log.Warn().Err(e).Msg("provider profile skipped")
	}
	s.registry.Replace(adapters)

	s.mu.Lock()
	s.profiles = list
	s.mu.Unlock()
}

// checkBuiltinsPresent ensures no currently-builtin profile was dropped.
func (s *ProfileStore) checkBuiltinsPresent(next []provider.ProviderProfile) error {
	nextIDs := make(map[string]struct{}, len(next))
	for _, p := range next {
		nextIDs[p.ID] = struct{}{}
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, p := range s.profiles {
		if !p.Builtin {
			continue
		}
		if _, ok := nextIDs[p.ID]; !ok {
			return fmt.Errorf("cannot delete builtin provider %q", p.ID)
		}
	}
	return nil
}

// validateProfiles enforces structural invariants independent of current state.
func validateProfiles(list []provider.ProviderProfile) error {
	seen := make(map[string]struct{}, len(list))
	for _, p := range list {
		id := strings.TrimSpace(p.ID)
		if id == "" {
			return fmt.Errorf("provider id must not be empty")
		}
		if _, dup := seen[id]; dup {
			return fmt.Errorf("duplicate provider id %q", id)
		}
		seen[id] = struct{}{}

		if strings.TrimSpace(p.Name) == "" {
			return fmt.Errorf("provider %q: name must not be empty", id)
		}
		switch p.Protocol {
		case provider.ProtocolOpenAI, provider.ProtocolAnthropic:
		default:
			return fmt.Errorf("provider %q: unknown protocol %q", id, p.Protocol)
		}
		if p.KeyRoutingStrategy != "" &&
			p.KeyRoutingStrategy != provider.RoutingFailover &&
			p.KeyRoutingStrategy != provider.RoutingRoundRobin {
			return fmt.Errorf("provider %q: unknown API key routing strategy %q", id, p.KeyRoutingStrategy)
		}
		if len(p.Endpoints) > 16 {
			return fmt.Errorf("provider %q: at most 16 endpoints are allowed", id)
		}
		if len(p.Endpoints) > 0 {
			if p.RoutingStrategy != "" &&
				p.RoutingStrategy != provider.RoutingFailover &&
				p.RoutingStrategy != provider.RoutingRoundRobin {
				return fmt.Errorf("provider %q: unknown routing strategy %q", id, p.RoutingStrategy)
			}
			seenEndpoints := make(map[string]struct{}, len(p.Endpoints))
			seenEndpointURLs := make(map[string]struct{}, len(p.Endpoints))
			enabledEndpoints := 0
			for _, endpoint := range p.Endpoints {
				endpointID := strings.TrimSpace(endpoint.ID)
				if endpointID == "" {
					return fmt.Errorf("provider %q: endpoint id must not be empty", id)
				}
				if _, duplicate := seenEndpoints[endpointID]; duplicate {
					return fmt.Errorf("provider %q: duplicate endpoint id %q", id, endpointID)
				}
				seenEndpoints[endpointID] = struct{}{}
				if err := validateProviderBaseURL(endpoint.BaseURL); err != nil {
					return fmt.Errorf("provider %q endpoint %q: %w", id, endpointID, err)
				}
				normalizedURL := strings.ToLower(strings.TrimRight(strings.TrimSpace(endpoint.BaseURL), "/"))
				if _, duplicate := seenEndpointURLs[normalizedURL]; duplicate {
					return fmt.Errorf("provider %q: duplicate endpoint URL", id)
				}
				seenEndpointURLs[normalizedURL] = struct{}{}
				if endpoint.Enabled {
					enabledEndpoints++
				}
			}
			if enabledEndpoints == 0 {
				return fmt.Errorf("provider %q: at least one endpoint must be enabled", id)
			}
		} else if strings.TrimSpace(p.BaseURL) == "" && !p.Builtin {
			// Builtins may leave base_url empty and use their SDK default.
			return fmt.Errorf("provider %q: base_url must not be empty", id)
		} else if strings.TrimSpace(p.BaseURL) != "" {
			if err := validateProviderBaseURL(p.BaseURL); err != nil {
				return fmt.Errorf("provider %q: %w", id, err)
			}
		}
		if len(p.Models) == 0 {
			return fmt.Errorf("provider %q: at least one model is required", id)
		}
		modelIDs := make(map[string]struct{}, len(p.Models))
		for _, model := range p.Models {
			modelID := strings.TrimSpace(model)
			if modelID == "" {
				return fmt.Errorf("provider %q: model id must not be empty", id)
			}
			if _, duplicate := modelIDs[modelID]; duplicate {
				return fmt.Errorf("provider %q: duplicate model id %q", id, modelID)
			}
			modelIDs[modelID] = struct{}{}
		}
		seenConfigs := make(map[string]struct{}, len(p.ModelConfigs))
		for _, config := range p.ModelConfigs {
			modelID := strings.TrimSpace(config.ID)
			if _, ok := modelIDs[modelID]; !ok {
				return fmt.Errorf("provider %q: model config %q has no matching model", id, modelID)
			}
			if _, duplicate := seenConfigs[modelID]; duplicate {
				return fmt.Errorf("provider %q: duplicate model config %q", id, modelID)
			}
			seenConfigs[modelID] = struct{}{}
			if config.InputPrice < 0 || config.OutputPrice < 0 {
				return fmt.Errorf("provider %q model %q: prices must not be negative", id, modelID)
			}
		}
	}
	return nil
}

func validateProviderBaseURL(raw string) error {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return fmt.Errorf("base_url must be an absolute HTTP(S) URL")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return fmt.Errorf("base_url must not contain credentials, query, or fragment")
	}
	return nil
}

// sortedProfiles returns profiles ordered builtin-first then by name, for
// stable presentation in the API response.
func sortedProfiles(list []provider.ProviderProfile) []provider.ProviderProfile {
	out := make([]provider.ProviderProfile, len(list))
	copy(out, list)
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Builtin != out[j].Builtin {
			return out[i].Builtin // builtins first
		}
		return out[i].Name < out[j].Name
	})
	return out
}
