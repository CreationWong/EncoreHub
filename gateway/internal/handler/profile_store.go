package handler

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"

	"github.com/encorehub/gateway/internal/engine"
	"github.com/encorehub/gateway/internal/provider"
	"github.com/encorehub/gateway/internal/provider/profiles"
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
		// Builtins (openai/anthropic) may leave base_url empty — their adapters
		// fall back to the provider's default endpoint. Custom providers must
		// give an explicit endpoint, since there's no default to fall back to.
		if strings.TrimSpace(p.BaseURL) == "" && !p.Builtin {
			return fmt.Errorf("provider %q: base_url must not be empty", id)
		}
		if len(p.Models) == 0 {
			return fmt.Errorf("provider %q: at least one model is required", id)
		}
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
