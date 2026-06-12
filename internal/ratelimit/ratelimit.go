package ratelimit

import (
	"sync"
	"time"
)

type entry struct {
	count       int
	windowStart time.Time
	lastSeen    time.Time
}

type Limiter struct {
	mu         sync.Mutex
	entries    map[string]entry
	limit      int
	window     time.Duration
	maxEntries int
	now        func() time.Time
}

func New(limit int, window time.Duration, maxEntries int) *Limiter {
	return &Limiter{
		entries:    make(map[string]entry),
		limit:      limit,
		window:     window,
		maxEntries: maxEntries,
		now:        time.Now,
	}
}

func (l *Limiter) Allow(key string) bool {
	now := l.now()
	l.mu.Lock()
	defer l.mu.Unlock()

	current, ok := l.entries[key]
	if !ok || now.Sub(current.windowStart) >= l.window {
		l.entries[key] = entry{count: 1, windowStart: now, lastSeen: now}
		l.cleanup(now)
		return true
	}
	current.lastSeen = now
	if current.count >= l.limit {
		l.entries[key] = current
		return false
	}
	current.count++
	l.entries[key] = current
	return true
}

func (l *Limiter) cleanup(now time.Time) {
	if len(l.entries) <= l.maxEntries {
		return
	}
	for key, value := range l.entries {
		if now.Sub(value.lastSeen) >= 2*l.window {
			delete(l.entries, key)
		}
	}
	if len(l.entries) <= l.maxEntries {
		return
	}
	for key := range l.entries {
		delete(l.entries, key)
		if len(l.entries) <= l.maxEntries {
			break
		}
	}
}
