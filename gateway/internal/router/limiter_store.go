package router

import (
	"sync"
	"time"

	"golang.org/x/time/rate"
)

type limiterEntry struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

type limiterStore struct {
	mu       sync.Mutex
	entries  map[string]*limiterEntry
	limit    rate.Limit
	burst    int
	ttl      time.Duration
	capacity int
	now      func() time.Time
	nextGC   time.Time
}

func newLimiterStore(limit rate.Limit, burst int, ttl time.Duration, capacity int, now func() time.Time) *limiterStore {
	return &limiterStore{
		entries:  make(map[string]*limiterEntry),
		limit:    limit,
		burst:    burst,
		ttl:      ttl,
		capacity: capacity,
		now:      now,
	}
}

func (s *limiterStore) allow(client string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := s.now()
	if entry, ok := s.entries[client]; ok {
		entry.lastSeen = now
		return entry.limiter.AllowN(now, 1)
	}

	if s.nextGC.IsZero() || !now.Before(s.nextGC) {
		s.removeExpired(now)
		interval := s.ttl / 2
		if interval <= 0 {
			interval = s.ttl
		}
		s.nextGC = now.Add(interval)
	}
	if len(s.entries) >= s.capacity {
		s.evictOldest()
	}

	entry := &limiterEntry{
		limiter:  rate.NewLimiter(s.limit, s.burst),
		lastSeen: now,
	}
	s.entries[client] = entry
	return entry.limiter.AllowN(now, 1)
}

func (s *limiterStore) removeExpired(now time.Time) {
	for client, entry := range s.entries {
		if !entry.lastSeen.Add(s.ttl).After(now) {
			delete(s.entries, client)
		}
	}
}

func (s *limiterStore) evictOldest() {
	var oldestClient string
	var oldestTime time.Time
	for client, entry := range s.entries {
		if oldestClient == "" || entry.lastSeen.Before(oldestTime) {
			oldestClient = client
			oldestTime = entry.lastSeen
		}
	}
	if oldestClient != "" {
		delete(s.entries, oldestClient)
	}
}

func (s *limiterStore) len() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.entries)
}

func (s *limiterStore) contains(client string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, ok := s.entries[client]
	return ok
}
