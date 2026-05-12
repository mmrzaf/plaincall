package rtc

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"testing"
)

// These tests run against a real LiveKit server. Start one and point them at
// it, for example:
//
//	livekit-server --dev &
//	LIVEKIT_TEST_URL=http://127.0.0.1:7880 go test ./internal/rtc
//
// LIVEKIT_TEST_KEY and LIVEKIT_TEST_SECRET default to the dev credentials.
func liveClient(t *testing.T) (*Client, string) {
	t.Helper()
	base := os.Getenv("LIVEKIT_TEST_URL")
	if base == "" {
		t.Skip("set LIVEKIT_TEST_URL to test against a real LiveKit server")
	}
	key, secret := os.Getenv("LIVEKIT_TEST_KEY"), os.Getenv("LIVEKIT_TEST_SECRET")
	if key == "" {
		key, secret = "devkey", "secret"
	}
	return New(base, key, secret), base
}

func TestLiveKitAcceptsJoinTokens(t *testing.T) {
	c, base := liveClient(t)
	for _, role := range []Role{RoleGuest, RoleMember} {
		token, err := c.JoinToken("integration-room", "Ada", role)
		if err != nil {
			t.Fatal(err)
		}
		resp, err := http.Get(base + "/rtc/validate?access_token=" + url.QueryEscape(token))
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Errorf("%s token rejected: %d %s", role, resp.StatusCode, body)
		}
	}
}

func TestLiveKitRoomLifecycle(t *testing.T) {
	c, _ := liveClient(t)
	ctx := context.Background()
	const room = "integration-lifecycle"
	t.Cleanup(func() { _ = c.End(ctx, room) })

	presence, err := c.Presence(ctx, room)
	if err != nil {
		t.Fatalf("Presence on a missing room: %v", err)
	}
	if presence != (Presence{}) {
		t.Errorf("a missing room should be empty and unlocked, got %+v", presence)
	}

	if err := c.SetLocked(ctx, room, true); !errors.Is(err, ErrNotFound) {
		t.Errorf("SetLocked on a missing room = %v, want ErrNotFound", err)
	}

	// Rooms normally appear when the first participant joins. Create one directly.
	if err := c.call(ctx, "CreateRoom", room, map[string]any{"name": room}, nil); err != nil {
		t.Fatalf("CreateRoom: %v", err)
	}
	if err := c.SetLocked(ctx, room, true); err != nil {
		t.Fatalf("SetLocked: %v", err)
	}
	if presence, err = c.Presence(ctx, room); err != nil || !presence.Locked {
		t.Errorf("Presence after locking = %+v, %v", presence, err)
	}
	if err := c.SetLocked(ctx, room, false); err != nil {
		t.Fatal(err)
	}
	if presence, _ = c.Presence(ctx, room); presence.Locked {
		t.Error("room is still locked after unlocking")
	}

	if err := c.Remove(ctx, room, "nobody"); !errors.Is(err, ErrNotFound) {
		t.Errorf("Remove of an absent participant = %v, want ErrNotFound", err)
	}
	if err := c.End(ctx, room); err != nil {
		t.Fatalf("End: %v", err)
	}
	if err := c.End(ctx, room); !errors.Is(err, ErrNotFound) {
		t.Errorf("End of a closed room = %v, want ErrNotFound", err)
	}
}

func TestLiveKitRejectsWrongSecret(t *testing.T) {
	_, base := liveClient(t)
	bad := New(base, "devkey", "not-the-secret-not-the-secret-1234")
	if err := bad.End(context.Background(), "integration-room"); err == nil || errors.Is(err, ErrNotFound) {
		t.Errorf("a wrong secret should fail with an authorization error, got %v", err)
	}
}
