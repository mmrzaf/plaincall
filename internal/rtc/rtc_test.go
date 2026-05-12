package rtc

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	testKey    = "test-key"
	testSecret = "test-secret-that-is-long-enough-1234"
)

func parseToken(t *testing.T, raw string) accessClaims {
	t.Helper()
	var claims accessClaims
	_, err := jwt.ParseWithClaims(raw, &claims, func(*jwt.Token) (any, error) {
		return []byte(testSecret), nil
	}, jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer(testKey), jwt.WithExpirationRequired())
	if err != nil {
		t.Fatalf("token does not verify: %v", err)
	}
	return claims
}

func TestJoinToken(t *testing.T) {
	c := New("http://unused", testKey, testSecret)
	fixed := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	c.now = func() time.Time { return fixed }

	raw, err := c.JoinToken("standup", "Ada Lovelace", RoleMember)
	if err != nil {
		t.Fatalf("JoinToken: %v", err)
	}
	// Parse without time validation, since the token is dated in the past.
	var claims accessClaims
	if _, err := jwt.ParseWithClaims(raw, &claims, func(*jwt.Token) (any, error) { return []byte(testSecret), nil },
		jwt.WithValidMethods([]string{"HS256"}), jwt.WithTimeFunc(func() time.Time { return fixed })); err != nil {
		t.Fatalf("token does not verify: %v", err)
	}

	if claims.Issuer != testKey {
		t.Errorf("issuer = %q", claims.Issuer)
	}
	if !strings.HasPrefix(claims.Subject, "p_") || len(claims.Subject) < 10 {
		t.Errorf("identity = %q", claims.Subject)
	}
	if want := fixed.Add(joinTokenTTL); !claims.ExpiresAt.Equal(want) {
		t.Errorf("expiry = %v, want %v", claims.ExpiresAt.Time, want)
	}
	if claims.Name != "Ada Lovelace" {
		t.Errorf("name = %q", claims.Name)
	}
	if claims.Attributes[RoleAttribute] != "member" {
		t.Errorf("attributes = %v", claims.Attributes)
	}
	v := claims.Video
	if v.Room != "standup" || !v.RoomJoin {
		t.Errorf("grant = %+v", v)
	}
	if v.RoomAdmin || v.RoomCreate || v.RoomList {
		t.Errorf("join tokens must not carry admin grants: %+v", v)
	}
	if v.CanPublish == nil || !*v.CanPublish || v.CanSubscribe == nil || !*v.CanSubscribe {
		t.Errorf("participants should publish and subscribe: %+v", v)
	}
	if v.CanPublishData == nil || *v.CanPublishData {
		t.Errorf("participants should not publish data: %+v", v)
	}
	if len(v.CanPublishSources) != 4 {
		t.Errorf("sources = %v", v.CanPublishSources)
	}
}

func TestJoinTokensHaveDistinctIdentities(t *testing.T) {
	c := New("http://unused", testKey, testSecret)
	a, _ := c.JoinToken("standup", "A", RoleGuest)
	b, _ := c.JoinToken("standup", "A", RoleGuest)
	if parseToken(t, a).Subject == parseToken(t, b).Subject {
		t.Error("two joins produced the same identity")
	}
}

// fakeLiveKit serves LiveKit's room service from canned responses and records
// what it was asked.
type fakeLiveKit struct {
	t         *testing.T
	responses map[string]string // method -> JSON body
	status    map[string]int    // method -> HTTP status, default 200
	requests  map[string]map[string]any
	claims    map[string]accessClaims
}

func newFake(t *testing.T) (*fakeLiveKit, *Client) {
	t.Helper()
	f := &fakeLiveKit{
		t:         t,
		responses: map[string]string{},
		status:    map[string]int{},
		requests:  map[string]map[string]any{},
		claims:    map[string]accessClaims{},
	}
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	return f, New(srv.URL, testKey, testSecret)
}

func (f *fakeLiveKit) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	method, ok := strings.CutPrefix(r.URL.Path, "/twirp/livekit.RoomService/")
	if !ok || r.Method != http.MethodPost || r.Header.Get("Content-Type") != "application/json" {
		f.t.Errorf("unexpected request %s %s (%s)", r.Method, r.URL.Path, r.Header.Get("Content-Type"))
		http.NotFound(w, r)
		return
	}
	token, _ := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	var claims accessClaims
	if _, err := jwt.ParseWithClaims(token, &claims, func(*jwt.Token) (any, error) { return []byte(testSecret), nil }); err != nil {
		f.t.Errorf("%s: bad admin token: %v", method, err)
	}
	f.claims[method] = claims
	body, _ := io.ReadAll(r.Body)
	var req map[string]any
	_ = json.Unmarshal(body, &req)
	f.requests[method] = req

	w.Header().Set("Content-Type", "application/json")
	if status := f.status[method]; status != 0 {
		w.WriteHeader(status)
	}
	response := f.responses[method]
	if response == "" {
		response = "{}"
	}
	_, _ = io.WriteString(w, response)
}

func TestPresence(t *testing.T) {
	tests := []struct {
		name         string
		rooms        string
		participants string
		want         Presence
	}{
		{"room does not exist", `{"rooms":[]}`, "", Presence{}},
		{"room without members", `{"rooms":[{"name":"x","metadata":""}]}`,
			`{"participants":[{"state":"ACTIVE","attributes":{"role":"guest"}}]}`, Presence{}},
		{"member present", `{"rooms":[{"name":"x"}]}`,
			`{"participants":[{"state":"ACTIVE","attributes":{"role":"guest"}},{"state":"JOINED","attributes":{"role":"member"}}]}`,
			Presence{MemberPresent: true}},
		{"member still joining", `{"rooms":[{"name":"x"}]}`,
			`{"participants":[{"state":"JOINING","attributes":{"role":"member"}}]}`, Presence{MemberPresent: true}},
		{"disconnected member does not count", `{"rooms":[{"name":"x"}]}`,
			`{"participants":[{"state":"DISCONNECTED","attributes":{"role":"member"}}]}`, Presence{}},
		{"participant without attributes", `{"rooms":[{"name":"x"}]}`,
			`{"participants":[{"state":"ACTIVE"}]}`, Presence{}},
		{"locked room", `{"rooms":[{"name":"x","metadata":"{\"locked\":true}"}]}`,
			`{"participants":[{"state":"ACTIVE","attributes":{"role":"member"}}]}`, Presence{Locked: true, MemberPresent: true}},
		{"unreadable metadata is unlocked", `{"rooms":[{"name":"x","metadata":"not json"}]}`,
			`{"participants":[]}`, Presence{}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f, c := newFake(t)
			f.responses["ListRooms"] = tt.rooms
			f.responses["ListParticipants"] = tt.participants
			got, err := c.Presence(context.Background(), "x")
			if err != nil {
				t.Fatalf("Presence: %v", err)
			}
			if got != tt.want {
				t.Errorf("Presence = %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestPresenceRequestsAndGrants(t *testing.T) {
	f, c := newFake(t)
	f.responses["ListRooms"] = `{"rooms":[{"name":"standup"}]}`
	f.responses["ListParticipants"] = `{"participants":[]}`
	if _, err := c.Presence(context.Background(), "standup"); err != nil {
		t.Fatal(err)
	}
	if names, _ := f.requests["ListRooms"]["names"].([]any); len(names) != 1 || names[0] != "standup" {
		t.Errorf("ListRooms request = %v", f.requests["ListRooms"])
	}
	if f.requests["ListParticipants"]["room"] != "standup" {
		t.Errorf("ListParticipants request = %v", f.requests["ListParticipants"])
	}
	for method, claims := range f.claims {
		v := claims.Video
		if v.Room != "standup" || !v.RoomAdmin || !v.RoomList || !v.RoomCreate {
			t.Errorf("%s token grant = %+v", method, v)
		}
		if claims.ExpiresAt == nil || time.Until(claims.ExpiresAt.Time) > adminTokenTTL {
			t.Errorf("%s token lives too long: %v", method, claims.ExpiresAt)
		}
	}
}

func TestPresenceRoomVanishesBetweenCalls(t *testing.T) {
	f, c := newFake(t)
	f.responses["ListRooms"] = `{"rooms":[{"name":"x","metadata":"{\"locked\":true}"}]}`
	f.status["ListParticipants"] = http.StatusNotFound
	f.responses["ListParticipants"] = `{"code":"not_found","msg":"room does not exist"}`
	got, err := c.Presence(context.Background(), "x")
	if err != nil {
		t.Fatalf("Presence: %v", err)
	}
	if !got.Locked || got.MemberPresent {
		t.Errorf("Presence = %+v", got)
	}
}

func TestRemoveEndAndLock(t *testing.T) {
	f, c := newFake(t)
	ctx := context.Background()

	if err := c.Remove(ctx, "standup", "p_123"); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	if r := f.requests["RemoveParticipant"]; r["room"] != "standup" || r["identity"] != "p_123" {
		t.Errorf("RemoveParticipant request = %v", r)
	}

	if err := c.End(ctx, "standup"); err != nil {
		t.Fatalf("End: %v", err)
	}
	if f.requests["DeleteRoom"]["room"] != "standup" {
		t.Errorf("DeleteRoom request = %v", f.requests["DeleteRoom"])
	}

	if err := c.SetLocked(ctx, "standup", true); err != nil {
		t.Fatalf("SetLocked: %v", err)
	}
	r := f.requests["UpdateRoomMetadata"]
	if r["room"] != "standup" {
		t.Errorf("UpdateRoomMetadata request = %v", r)
	}
	if !parseMetadata(r["metadata"].(string)).Locked {
		t.Errorf("metadata = %v, want locked", r["metadata"])
	}
	if err := c.SetLocked(ctx, "standup", false); err != nil {
		t.Fatal(err)
	}
	if parseMetadata(f.requests["UpdateRoomMetadata"]["metadata"].(string)).Locked {
		t.Error("metadata still locked after unlocking")
	}
}

func TestErrors(t *testing.T) {
	f, c := newFake(t)
	ctx := context.Background()

	f.status["RemoveParticipant"] = http.StatusNotFound
	f.responses["RemoveParticipant"] = `{"code":"not_found","msg":"participant does not exist"}`
	if err := c.Remove(ctx, "standup", "gone"); !errors.Is(err, ErrNotFound) {
		t.Errorf("Remove error = %v, want ErrNotFound", err)
	}

	f.status["DeleteRoom"] = http.StatusUnauthorized
	f.responses["DeleteRoom"] = `{"code":"unauthenticated","msg":"invalid token"}`
	err := c.End(ctx, "standup")
	if err == nil || errors.Is(err, ErrNotFound) || !strings.Contains(err.Error(), "401") {
		t.Errorf("End error = %v", err)
	}

	f.responses["ListRooms"] = "not json"
	if _, err := c.Presence(ctx, "standup"); err == nil {
		t.Error("Presence accepted an undecodable response")
	}
}

func TestUnreachableServer(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	url := srv.URL
	srv.Close()
	c := New(url, testKey, testSecret)
	if _, err := c.Presence(context.Background(), "standup"); err == nil {
		t.Error("expected an error when LiveKit is unreachable")
	}
}
