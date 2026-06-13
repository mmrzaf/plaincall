package livekittoken

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestIssueCreatesSignedJoinToken(t *testing.T) {
	now := time.Date(2026, 6, 12, 12, 0, 0, 0, time.UTC)
	issuer := New("test-key", "01234567890123456789012345678901", 30*time.Minute)
	issuer.now = func() time.Time { return now }
	issuer.rand = strings.NewReader("abcdefghijklmnopqrstuvwx")

	token, identity, err := issuer.Issue("pc_internal", "Alice", time.Time{})
	if err != nil {
		t.Fatalf("Issue() error = %v", err)
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatalf("Issue() token has %d parts, want 3", len(parts))
	}
	mac := hmac.New(sha256.New, []byte("01234567890123456789012345678901"))
	_, _ = mac.Write([]byte(parts[0] + "." + parts[1]))
	if parts[2] != base64.RawURLEncoding.EncodeToString(mac.Sum(nil)) {
		t.Fatal("Issue() token signature is invalid")
	}

	got := decodeClaims(t, parts[1])
	if got["iss"] != "test-key" || got["sub"] != identity || got["name"] != "Alice" {
		t.Fatalf("claims = %#v", got)
	}
	video := got["video"].(map[string]any)
	if video["room"] != "pc_internal" || video["roomJoin"] != true || video["canPublish"] != true || video["canSubscribe"] != true || video["canPublishData"] != false {
		t.Fatalf("video grant = %#v", video)
	}
	if got["exp"] != float64(now.Add(30*time.Minute).Unix()) {
		t.Fatalf("exp = %#v", got["exp"])
	}
}

func TestIssueCapsExpiryAtInvitationExpiry(t *testing.T) {
	now := time.Date(2026, 6, 12, 12, 0, 0, 0, time.UTC)
	issuer := New("test-key", "01234567890123456789012345678901", 30*time.Minute)
	issuer.now = func() time.Time { return now }
	issuer.rand = strings.NewReader("abcdefghijklmnopqrstuvwx")
	invitationExpiry := now.Add(20 * time.Second)
	token, _, err := issuer.Issue("pc_internal", "Alice", invitationExpiry)
	if err != nil {
		t.Fatalf("Issue() error = %v", err)
	}
	got := decodeClaims(t, strings.Split(token, ".")[1])
	if got["exp"] != float64(invitationExpiry.Unix()) {
		t.Fatalf("exp = %#v", got["exp"])
	}
}

func decodeClaims(t *testing.T, encoded string) map[string]any {
	t.Helper()
	payload, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("decode payload: %v", err)
	}
	var got map[string]any
	if err := json.Unmarshal(payload, &got); err != nil {
		t.Fatalf("decode JSON: %v", err)
	}
	return got
}
