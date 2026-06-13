package roomtoken

import (
	"bytes"
	"strings"
	"testing"
	"time"
)

func TestCreateAndResolveShortCode(t *testing.T) {
	manager := New("01234567890123456789012345678901", time.Hour)
	manager.rand = bytes.NewReader([]byte{0, 1, 2, 3, 4, 5, 6, 7, 8, 9})

	room, err := manager.Create()
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if room.Code != "234-5678-9ab" {
		t.Fatalf("Create() code = %q", room.Code)
	}
	if !strings.HasPrefix(room.LiveKitRoom, "pc_") || strings.Contains(room.LiveKitRoom, room.Code) {
		t.Fatalf("Create() LiveKit room = %q", room.LiveKitRoom)
	}
	if !room.ExpiresAt.IsZero() {
		t.Fatalf("Create() expiry = %v, want zero", room.ExpiresAt)
	}

	resolved, err := manager.Resolve(" 234 5678 9AB ")
	if err != nil {
		t.Fatalf("Resolve() error = %v", err)
	}
	if resolved != room {
		t.Fatalf("Resolve() = %#v, want %#v", resolved, room)
	}
}

func TestResolveRejectsMalformedShortCode(t *testing.T) {
	manager := New("01234567890123456789012345678901", time.Hour)
	for _, code := range []string{"", "abc", "abc-defg-hij", "abc-defg-hj!", "abc-defg-hjkl"} {
		if _, err := manager.Resolve(code); err == nil {
			t.Fatalf("Resolve(%q) accepted malformed code", code)
		}
	}
}

func TestLegacyLinksRemainValidAndExpire(t *testing.T) {
	now := time.Date(2026, 6, 12, 12, 0, 0, 0, time.UTC)
	manager := New("01234567890123456789012345678901", time.Minute)
	manager.now = func() time.Time { return now }
	manager.rand = bytes.NewReader([]byte("abcdefghijkl"))

	legacy, err := manager.createLegacy()
	if err != nil {
		t.Fatalf("createLegacy() error = %v", err)
	}
	if !strings.HasPrefix(legacy.Code, "r.") {
		t.Fatalf("legacy code = %q", legacy.Code)
	}
	if _, err := manager.Resolve(legacy.Code); err != nil {
		t.Fatalf("Resolve(legacy) error = %v", err)
	}

	tampered := legacy.Code[:len(legacy.Code)-1] + "x"
	if _, err := manager.Resolve(tampered); err == nil {
		t.Fatal("Resolve() accepted tampered legacy room")
	}
	manager.now = func() time.Time { return now.Add(2 * time.Minute) }
	if _, err := manager.Resolve(legacy.Code); err == nil {
		t.Fatal("Resolve() accepted expired legacy room")
	}
}
