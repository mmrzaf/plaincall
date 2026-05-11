package ratelimit

import (
	"testing"
	"time"
)

func newTestLimiter(limit int, window time.Duration) (*Limiter, *time.Time) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	l := New(limit, window)
	l.now = func() time.Time { return now }
	return l, &now
}

func TestAllowUpToLimit(t *testing.T) {
	l, _ := newTestLimiter(3, time.Minute)
	for i := range 3 {
		if !l.Allow("a") {
			t.Fatalf("event %d was refused", i+1)
		}
	}
	if l.Allow("a") {
		t.Error("event over the limit was allowed")
	}
	if !l.Allow("b") {
		t.Error("a different key should have its own budget")
	}
}

func TestWindowResets(t *testing.T) {
	l, now := newTestLimiter(1, time.Minute)
	if !l.Allow("a") || l.Allow("a") {
		t.Fatal("first event should pass and second should not")
	}
	*now = now.Add(time.Minute)
	if !l.Allow("a") {
		t.Error("a new window should allow events again")
	}
}

func TestBlockedDoesNotRecord(t *testing.T) {
	l, now := newTestLimiter(2, time.Minute)
	if l.Blocked("a") {
		t.Fatal("unknown key reported as blocked")
	}
	l.Allow("a")
	if l.Blocked("a") {
		t.Error("blocked before the limit was reached")
	}
	l.Allow("a")
	if !l.Blocked("a") {
		t.Error("not blocked after reaching the limit")
	}
	*now = now.Add(time.Minute)
	if l.Blocked("a") {
		t.Error("still blocked after the window ended")
	}
}

func TestPurgeRemovesExpiredBuckets(t *testing.T) {
	l, now := newTestLimiter(1, time.Minute)
	l.Allow("a")
	l.Allow("b")
	*now = now.Add(2 * time.Minute)
	l.Allow("c")
	if len(l.buckets) != 1 {
		t.Errorf("buckets = %d, want only the current one", len(l.buckets))
	}
}
