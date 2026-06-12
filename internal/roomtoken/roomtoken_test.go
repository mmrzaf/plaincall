package roomtoken

import (
	"bytes"
	"strings"
	"testing"
	"time"
)

func TestCreateAndVerify(t *testing.T) {
	now := time.Date(2026, 6, 12, 12, 0, 0, 0, time.UTC)
	manager := New("01234567890123456789012345678901", time.Hour)
	manager.now = func() time.Time { return now }
	manager.rand = bytes.NewReader([]byte("abcdefghijkl"))

	room, expiresAt, err := manager.Create()
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if !strings.HasPrefix(room, "r.") {
		t.Fatalf("Create() room = %q, want r. prefix", room)
	}
	if want := now.Add(time.Hour); !expiresAt.Equal(want) {
		t.Fatalf("Create() expiresAt = %v, want %v", expiresAt, want)
	}
	if err := manager.Verify(room); err != nil {
		t.Fatalf("Verify() error = %v", err)
	}
}

func TestVerifyRejectsTamperingAndExpiry(t *testing.T) {
	now := time.Date(2026, 6, 12, 12, 0, 0, 0, time.UTC)
	manager := New("01234567890123456789012345678901", time.Minute)
	manager.now = func() time.Time { return now }
	manager.rand = bytes.NewReader([]byte("abcdefghijkl"))

	room, _, err := manager.Create()
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	tampered := room[:len(room)-1] + "x"
	if err := manager.Verify(tampered); err == nil {
		t.Fatal("Verify() accepted tampered room")
	}

	manager.now = func() time.Time { return now.Add(2 * time.Minute) }
	if err := manager.Verify(room); err == nil {
		t.Fatal("Verify() accepted expired room")
	}
}
