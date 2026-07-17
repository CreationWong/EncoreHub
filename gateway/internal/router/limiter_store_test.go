package router

import (
	"fmt"
	"testing"
	"time"

	"golang.org/x/time/rate"
)

func TestLimiterStoreExpiresIdleClients(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	store := newLimiterStore(rate.Limit(100), 100, time.Minute, 10, func() time.Time { return now })

	if !store.allow("client-a") {
		t.Fatal("first request should be allowed")
	}
	now = now.Add(time.Minute + time.Second)
	if !store.allow("client-b") {
		t.Fatal("new client request should be allowed")
	}
	if store.contains("client-a") {
		t.Fatal("expired client was not removed")
	}
	if got := store.len(); got != 1 {
		t.Fatalf("store size = %d, want 1", got)
	}
}

func TestLimiterStoreEvictsLeastRecentlyUsedAtCapacity(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	store := newLimiterStore(rate.Limit(100), 100, time.Hour, 2, func() time.Time { return now })

	store.allow("client-a")
	now = now.Add(time.Second)
	store.allow("client-b")
	now = now.Add(time.Second)
	store.allow("client-a")
	now = now.Add(time.Second)
	store.allow("client-c")

	if store.contains("client-b") {
		t.Fatal("least recently used client was not evicted")
	}
	if !store.contains("client-a") || !store.contains("client-c") {
		t.Fatalf("unexpected entries after eviction: a=%v c=%v", store.contains("client-a"), store.contains("client-c"))
	}
}

func TestLimiterStoreNeverExceedsCapacity(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	store := newLimiterStore(rate.Limit(100), 100, time.Hour, 5, func() time.Time { return now })
	for i := 0; i < 100; i++ {
		now = now.Add(time.Millisecond)
		store.allow(fmt.Sprintf("client-%d", i))
		if got := store.len(); got > 5 {
			t.Fatalf("store exceeded capacity: %d", got)
		}
	}
}
