package provider

import (
	"fmt"
	"sync"
)

// Registry manages all registered AI provider adapters.
type Registry struct {
	mu       sync.RWMutex
	adapters map[string]Adapter
}

// NewRegistry creates a registry with the given adapters.
func NewRegistry(adapters ...Adapter) *Registry {
	r := &Registry{
		adapters: make(map[string]Adapter),
	}
	for _, a := range adapters {
		r.adapters[a.ID()] = a
	}
	return r
}

// Get returns the adapter for the given provider ID.
func (r *Registry) Get(providerID string) (Adapter, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	a, ok := r.adapters[providerID]
	if !ok {
		return nil, fmt.Errorf("unknown provider: %s", providerID)
	}
	return a, nil
}

// Register adds an adapter. Overwrites if the ID already exists.
func (r *Registry) Register(a Adapter) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.adapters[a.ID()] = a
}

// Replace atomically swaps the entire adapter set. Used when provider profiles
// change at runtime so in-flight Get() calls always see a consistent map.
func (r *Registry) Replace(adapters []Adapter) {
	next := make(map[string]Adapter, len(adapters))
	for _, a := range adapters {
		next[a.ID()] = a
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.adapters = next
}

// List returns all registered provider IDs.
func (r *Registry) List() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()

	ids := make([]string, 0, len(r.adapters))
	for id := range r.adapters {
		ids = append(ids, id)
	}
	return ids
}
