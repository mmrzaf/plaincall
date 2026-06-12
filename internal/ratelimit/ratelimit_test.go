package ratelimit

import (
	"testing"
	"time"
)

func TestAllowResetsAfterWindow(t *testing.T) {
	now := time.Date(2026, 6, 12, 12, 0, 0, 0, time.UTC)
	limiter := New(2, time.Minute, 10)
	limiter.now = func() time.Time { return now }

	if !limiter.Allow("client") || !limiter.Allow("client") {
		t.Fatal("Allow() rejected request within limit")
	}
	if limiter.Allow("client") {
		t.Fatal("Allow() accepted request above limit")
	}
	now = now.Add(time.Minute)
	if !limiter.Allow("client") {
		t.Fatal("Allow() did not reset after window")
	}
}
