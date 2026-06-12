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
	issuer := New("test-key", "01234567890123456789012345678901", 30*time.Minute)
	issuer.now = func() time.Time { return time.Date(2026, 6, 12, 12, 0, 0, 0, time.UTC) }
	issuer.rand = strings.NewReader("abcdefghijklmnopqrstuvwx")

	token, identity, err := issuer.Issue("r_room", "Alice")
	if err != nil {
		t.Fatalf("Issue() error = %v", err)
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatalf("Issue() token has %d parts, want 3", len(parts))
	}

	mac := hmac.New(sha256.New, []byte("01234567890123456789012345678901"))
	_, _ = mac.Write([]byte(parts[0] + "." + parts[1]))
	wantSignature := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if parts[2] != wantSignature {
		t.Fatal("Issue() token signature is invalid")
	}

	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatalf("decode payload: %v", err)
	}
	var got map[string]any
	if err := json.Unmarshal(payload, &got); err != nil {
		t.Fatalf("decode payload JSON: %v", err)
	}
	if got["iss"] != "test-key" || got["sub"] != identity || got["name"] != "Alice" {
		t.Fatalf("unexpected token claims: %#v", got)
	}
	video, ok := got["video"].(map[string]any)
	if !ok {
		t.Fatalf("video claim missing: %#v", got)
	}
	if video["room"] != "r_room" || video["roomJoin"] != true || video["canPublish"] != true || video["canSubscribe"] != true {
		t.Fatalf("unexpected video grant: %#v", video)
	}
	if video["canPublishData"] != false {
		t.Fatalf("canPublishData = %#v, want false", video["canPublishData"])
	}
}
