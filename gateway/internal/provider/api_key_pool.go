package provider

import (
	"encoding/json"
	"fmt"
	"strings"
)

const apiKeyPoolVersion = 1

// APIKeyPoolEntry is stored inside the Engine's opaque per-provider secret.
// The envelope is encrypted as one value; it never enters ProviderProfile.
type APIKeyPoolEntry struct {
	ID      string `json:"id"`
	Name    string `json:"name,omitempty"`
	Value   string `json:"value"`
	Enabled bool   `json:"enabled"`
}

type apiKeyPoolEnvelope struct {
	Version int               `json:"version"`
	Keys    []APIKeyPoolEntry `json:"keys"`
}

// ParseAPIKeyPool accepts both the versioned key-pool envelope and legacy
// single-key strings. IDs are safe to return from validation APIs; values
// remain request-local and must never be logged or serialized in responses.
func ParseAPIKeyPool(raw string) ([]APIKeyPoolEntry, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, nil
	}
	if !strings.HasPrefix(trimmed, "{") {
		return []APIKeyPoolEntry{{
			ID:      "primary",
			Name:    "Primary",
			Value:   trimmed,
			Enabled: true,
		}}, nil
	}

	var envelope apiKeyPoolEnvelope
	if err := json.Unmarshal([]byte(trimmed), &envelope); err != nil || envelope.Keys == nil {
		// A provider is allowed to issue an unusual key that begins with `{`.
		return []APIKeyPoolEntry{{
			ID:      "primary",
			Name:    "Primary",
			Value:   trimmed,
			Enabled: true,
		}}, nil
	}
	if envelope.Version != apiKeyPoolVersion {
		return nil, fmt.Errorf("unsupported API key pool version")
	}
	if len(envelope.Keys) == 0 || len(envelope.Keys) > 16 {
		return nil, fmt.Errorf("API key pool must contain between 1 and 16 keys")
	}

	seenIDs := make(map[string]struct{}, len(envelope.Keys))
	seenValues := make(map[string]struct{}, len(envelope.Keys))
	entries := make([]APIKeyPoolEntry, 0, len(envelope.Keys))
	enabledCount := 0
	for _, entry := range envelope.Keys {
		id := strings.TrimSpace(entry.ID)
		value := strings.TrimSpace(entry.Value)
		if id == "" || value == "" {
			return nil, fmt.Errorf("API key pool entries require an id and value")
		}
		if _, duplicate := seenIDs[id]; duplicate {
			return nil, fmt.Errorf("API key pool contains duplicate ids")
		}
		seenIDs[id] = struct{}{}
		if entry.Enabled {
			if _, duplicate := seenValues[value]; duplicate {
				return nil, fmt.Errorf("API key pool contains duplicate enabled keys")
			}
			seenValues[value] = struct{}{}
			enabledCount++
		}
		entries = append(entries, APIKeyPoolEntry{
			ID:      id,
			Name:    strings.TrimSpace(entry.Name),
			Value:   value,
			Enabled: entry.Enabled,
		})
	}
	if enabledCount == 0 {
		return nil, fmt.Errorf("API key pool has no enabled keys")
	}
	return entries, nil
}

// ParseAPIKeys returns only enabled key values for adapter routing.
func ParseAPIKeys(raw string) ([]string, error) {
	entries, err := ParseAPIKeyPool(raw)
	if err != nil {
		return nil, err
	}
	keys := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.Enabled {
			keys = append(keys, entry.Value)
		}
	}
	return keys, nil
}
