// Package ratelimit provides a small fixed-window rate limiter keyed by string.
package ratelimit

import (
	"sync"
	"time"
)

// maxKeys bounds memory use. When the table grows past it, it is emptied,
// which makes the limiter fail open rather than grow without limit.
const maxKeys = 50_000

// Limiter allows a number of events per key within each time window.
type Limiter struct {
	limit  int
	window time.Duration
	now    func() time.Time

	mu        sync.Mutex
	buckets   map[string]*bucket
	lastPurge time.Time
}

type bucket struct {
	start time.Time
	count int
}

// New returns a Limiter that allows limit events per key every window.
func New(limit int, window time.Duration) *Limiter {
	return &Limiter{
		limit:   limit,
		window:  window,
		now:     time.Now,
		buckets: make(map[string]*bucket),
	}
}

// Allow records an event for key and reports whether it is within the limit.
func (l *Limiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()
	l.purge(now)
	b, ok := l.buckets[key]
	if !ok || now.Sub(b.start) >= l.window {
		if len(l.buckets) >= maxKeys {
			clear(l.buckets)
		}
		b = &bucket{start: now}
		l.buckets[key] = b
	}
	if b.count >= l.limit {
		return false
	}
	b.count++
	return true
}

// Blocked reports whether key has used up its limit in the current window,
// without recording an event.
func (l *Limiter) Blocked(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	b, ok := l.buckets[key]
	return ok && l.now().Sub(b.start) < l.window && b.count >= l.limit
}

// purge drops expired buckets at most once per window.
func (l *Limiter) purge(now time.Time) {
	if now.Sub(l.lastPurge) < l.window {
		return
	}
	l.lastPurge = now
	for key, b := range l.buckets {
		if now.Sub(b.start) >= l.window {
			delete(l.buckets, key)
		}
	}
}
