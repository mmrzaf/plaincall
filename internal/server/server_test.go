package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/mmrzaf/plaincall/internal/config"
	"github.com/mmrzaf/plaincall/internal/rtc"
)

const memberKey = "0123456789abcdef0123"

type fakeLiveKit struct {
	presence    rtc.Presence
	presenceErr error
	actionErr   error
	room        rtc.Room // what OpenRoom reports
	openErr     error

	presenceCalls int
	opened        []openCall
	tokens        []tokenCall
	removed       []string
	ended         []string
	mutedOne      []string
	mutedAll      []string
	guestsMuted   int
	locked        []bool
}

type openCall struct {
	room    string
	quality rtc.Quality
	max     int
}

type tokenCall struct {
	room, name string
	role       rtc.Role
}

func (f *fakeLiveKit) JoinToken(room, name string, role rtc.Role) (string, error) {
	f.tokens = append(f.tokens, tokenCall{room, name, role})
	return "token-for-" + string(role), nil
}

func (f *fakeLiveKit) Presence(context.Context, string) (rtc.Presence, error) {
	f.presenceCalls++
	return f.presence, f.presenceErr
}

func (f *fakeLiveKit) OpenRoom(_ context.Context, room string, quality rtc.Quality, max int) (rtc.Room, error) {
	f.opened = append(f.opened, openCall{room, quality, max})
	return f.room, f.openErr
}

func (f *fakeLiveKit) Remove(_ context.Context, room, identity string) error {
	f.removed = append(f.removed, room+"/"+identity)
	return f.actionErr
}

func (f *fakeLiveKit) End(_ context.Context, room string) error {
	f.ended = append(f.ended, room)
	return f.actionErr
}

func (f *fakeLiveKit) MuteMicrophone(_ context.Context, room, identity string) error {
	f.mutedOne = append(f.mutedOne, room+"/"+identity)
	return f.actionErr
}

func (f *fakeLiveKit) MuteGuests(_ context.Context, room string) (int, error) {
	f.mutedAll = append(f.mutedAll, room)
	return f.guestsMuted, f.actionErr
}

func (f *fakeLiveKit) SetLocked(_ context.Context, _ string, locked bool) error {
	f.locked = append(f.locked, locked)
	return f.actionErr
}

type harness struct {
	lk      *fakeLiveKit
	handler http.Handler
}

func newHarness(t *testing.T, mutate ...func(*config.Config)) *harness {
	t.Helper()
	keys, err := config.ParseKeys("alice:" + memberKey)
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{
		Addr:            ":0",
		Keys:            keys,
		LiveKitURL:      "wss://rtc.example.com",
		LiveKitAPIURL:   "http://livekit:7880",
		MaxParticipants: 20,
	}
	for _, m := range mutate {
		m(&cfg)
	}
	lk := &fakeLiveKit{}
	assets := fstest.MapFS{
		"index.html":       {Data: []byte("<html>app</html>")},
		"favicon.svg":      {Data: []byte("<svg/>")},
		"assets/app-1.js":  {Data: []byte("console.log(1)")},
		"assets/app-1.css": {Data: []byte("body{}")},
	}
	return &harness{lk: lk, handler: New(Options{Config: cfg, LiveKit: lk, Assets: assets}).Handler()}
}

func (h *harness) do(method, target, body string, headers ...string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	rec := httptest.NewRecorder()
	h.handler.ServeHTTP(rec, req)
	return rec
}

func (h *harness) post(target, body string, headers ...string) *httptest.ResponseRecorder {
	return h.do(http.MethodPost, target, body, headers...)
}

func decode[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatalf("response is not the expected JSON: %v\n%s", err, rec.Body.String())
	}
	return v
}

func expectError(t *testing.T, rec *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if rec.Code != status {
		t.Fatalf("status = %d, want %d (%s)", rec.Code, status, rec.Body.String())
	}
	if got := decode[apiError](t, rec); got.Code != code {
		t.Fatalf("error code = %q, want %q", got.Code, code)
	}
}

func bearer(key string) string { return "Bearer " + key }

func TestGuestWaitsForHost(t *testing.T) {
	h := newHarness(t)
	rec := h.post("/api/join", `{"room":"standup","name":"Ada"}`)
	expectError(t, rec, http.StatusConflict, "waiting_for_host")
	if len(h.lk.tokens) != 0 {
		t.Error("a token was issued while no host was present")
	}
}

func TestGuestJoinsWhileHostPresent(t *testing.T) {
	h := newHarness(t)
	h.lk.presence = rtc.Presence{MemberPresent: true}
	rec := h.post("/api/join", `{"room":"StandUp","name":"  Ada   Lovelace "}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	got := decode[joinResponse](t, rec)
	if got.URL != "wss://rtc.example.com" || got.Token != "token-for-guest" || got.Role != rtc.RoleGuest {
		t.Errorf("response = %+v", got)
	}
	want := tokenCall{room: "standup", name: "Ada Lovelace", role: rtc.RoleGuest}
	if len(h.lk.tokens) != 1 || h.lk.tokens[0] != want {
		t.Errorf("tokens = %+v, want %+v", h.lk.tokens, want)
	}
}

func TestGuestRefusedWhenLocked(t *testing.T) {
	h := newHarness(t)
	h.lk.presence = rtc.Presence{Room: rtc.Room{Locked: true}, MemberPresent: true}
	expectError(t, h.post("/api/join", `{"room":"standup","name":"Ada"}`), http.StatusForbidden, "room_locked")
}

func TestMemberJoinsAnyRoom(t *testing.T) {
	h := newHarness(t)
	h.lk.room = rtc.Room{Locked: true} // nobody there, and locked
	rec := h.post("/api/join", `{"room":"standup","name":"Alice","key":"`+memberKey+`"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	if got := decode[joinResponse](t, rec); got.Role != rtc.RoleMember || got.Token != "token-for-member" {
		t.Errorf("response = %+v", got)
	}
	if h.lk.presenceCalls != 0 {
		t.Error("members should not depend on the room's state")
	}
}

func TestMemberStartsRoomWithPresetAndLimit(t *testing.T) {
	h := newHarness(t, func(c *config.Config) { c.MaxParticipants = 6 })
	rec := h.post("/api/join", `{"room":"standup","name":"Alice","key":"`+memberKey+`","quality":"low"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	want := openCall{room: "standup", quality: rtc.QualityLow, max: 6}
	if len(h.lk.opened) != 1 || h.lk.opened[0] != want {
		t.Errorf("opened = %+v, want %+v", h.lk.opened, want)
	}
	// The room did not exist, so it was created with the requested preset.
	h.lk.room = rtc.Room{Quality: rtc.QualityLow}
	if got := decode[joinResponse](t, h.post("/api/join", `{"room":"standup","name":"Alice","key":"`+memberKey+`","quality":"low"}`)); got.Quality != rtc.QualityLow {
		t.Errorf("quality = %q", got.Quality)
	}
}

func TestExistingRoomKeepsItsPreset(t *testing.T) {
	h := newHarness(t)
	h.lk.room = rtc.Room{Quality: rtc.QualityMeeting}
	got := decode[joinResponse](t, h.post("/api/join", `{"room":"standup","name":"Alice","key":"`+memberKey+`","quality":"low"}`))
	if got.Quality != rtc.QualityMeeting {
		t.Errorf("a second host's request changed the preset: %q", got.Quality)
	}
}

func TestDefaultPreset(t *testing.T) {
	h := newHarness(t)
	got := decode[joinResponse](t, h.post("/api/join", `{"room":"standup","name":"Alice","key":"`+memberKey+`"}`))
	if got.Quality != rtc.DefaultQuality || h.lk.opened[0].quality != rtc.DefaultQuality {
		t.Errorf("response %q, opened %+v; want the default preset", got.Quality, h.lk.opened)
	}
}

func TestGuestGetsTheRoomsPreset(t *testing.T) {
	h := newHarness(t)
	h.lk.presence = rtc.Presence{Room: rtc.Room{Quality: rtc.QualityLow}, MemberPresent: true}
	got := decode[joinResponse](t, h.post("/api/join", `{"room":"standup","name":"Ada","quality":"meeting"}`))
	if got.Quality != rtc.QualityLow {
		t.Errorf("a guest chose the preset: %q", got.Quality)
	}
	if len(h.lk.opened) != 0 {
		t.Error("a guest must not create rooms")
	}
}

func TestFullRoom(t *testing.T) {
	h := newHarness(t, func(c *config.Config) { c.MaxParticipants = 3 })

	h.lk.presence = rtc.Presence{Room: rtc.Room{Participants: 3}, MemberPresent: true}
	expectError(t, h.post("/api/join", `{"room":"standup","name":"Ada"}`), http.StatusConflict, "room_full")

	h.lk.presence = rtc.Presence{Room: rtc.Room{Participants: 2}, MemberPresent: true}
	if rec := h.post("/api/join", `{"room":"standup","name":"Ada"}`); rec.Code != http.StatusOK {
		t.Errorf("one place left: %d %s", rec.Code, rec.Body.String())
	}

	h.lk.room = rtc.Room{Participants: 3}
	expectError(t, h.post("/api/join", `{"room":"standup","name":"Alice","key":"`+memberKey+`"}`), http.StatusConflict, "room_full")
}

func TestFullRoomAnswersLockedAndWaitingFirst(t *testing.T) {
	h := newHarness(t, func(c *config.Config) { c.MaxParticipants = 2 })
	h.lk.presence = rtc.Presence{Room: rtc.Room{Participants: 2, Locked: true}, MemberPresent: true}
	expectError(t, h.post("/api/join", `{"room":"standup","name":"Ada"}`), http.StatusForbidden, "room_locked")
	h.lk.presence = rtc.Presence{Room: rtc.Room{Participants: 2}}
	expectError(t, h.post("/api/join", `{"room":"standup","name":"Ada"}`), http.StatusConflict, "waiting_for_host")
}

func TestJoinValidation(t *testing.T) {
	tests := []struct {
		name, body, code string
		status           int
	}{
		{"room too short", `{"room":"ab","name":"Ada"}`, "invalid_room", 400},
		{"room with spaces", `{"room":"my room","name":"Ada"}`, "invalid_room", 400},
		{"room with slash", `{"room":"a/b/c","name":"Ada"}`, "invalid_room", 400},
		{"room with leading hyphen", `{"room":"-abc","name":"Ada"}`, "invalid_room", 400},
		{"room with double hyphen", `{"room":"a--b","name":"Ada"}`, "invalid_room", 400},
		{"missing room", `{"name":"Ada"}`, "invalid_room", 400},
		{"missing name", `{"room":"standup"}`, "invalid_name", 400},
		{"blank name", `{"room":"standup","name":"   "}`, "invalid_name", 400},
		{"name too long", `{"room":"standup","name":"` + strings.Repeat("a", 41) + `"}`, "invalid_name", 400},
		{"name with control character", `{"room":"standup","name":"a\u0000b"}`, "invalid_name", 400},
		{"name with direction override", `{"room":"standup","name":"a\u202eb"}`, "invalid_name", 400},
		{"unknown preset", `{"room":"standup","name":"Ada","quality":"ultra"}`, "invalid_quality", 400},
		{"unknown field", `{"room":"standup","name":"Ada","admin":true}`, "bad_request", 400},
		{"not json", `hello`, "bad_request", 400},
		{"two objects", `{"room":"standup","name":"Ada"}{}`, "bad_request", 400},
		{"wrong key", `{"room":"standup","name":"Ada","key":"wrong-key-wrong-key"}`, "invalid_key", 401},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newHarness(t)
			expectError(t, h.post("/api/join", tt.body), tt.status, tt.code)
			if len(h.lk.tokens) != 0 {
				t.Error("a token was issued for an invalid request")
			}
		})
	}
}

func TestJoinAcceptsUnicodeNames(t *testing.T) {
	h := newHarness(t)
	h.lk.presence = rtc.Presence{MemberPresent: true}
	for _, name := range []string{"علی", "Zoë 👩‍💻", "山田太郎"} {
		body, _ := json.Marshal(joinRequest{Room: "standup", Name: name})
		if rec := h.post("/api/join", string(body)); rec.Code != http.StatusOK {
			t.Errorf("name %q refused: %s", name, rec.Body.String())
		}
	}
}

func TestJoinRequiresJSON(t *testing.T) {
	h := newHarness(t)
	req := httptest.NewRequest(http.MethodPost, "/api/join", strings.NewReader(`{"room":"standup","name":"Ada"}`))
	req.Header.Set("Content-Type", "text/plain")
	rec := httptest.NewRecorder()
	h.handler.ServeHTTP(rec, req)
	expectError(t, rec, http.StatusUnsupportedMediaType, "bad_request")
}

func TestJoinLiveKitFailure(t *testing.T) {
	h := newHarness(t)
	h.lk.presenceErr = errors.New("connection refused")
	expectError(t, h.post("/api/join", `{"room":"standup","name":"Ada"}`), http.StatusBadGateway, "unavailable")
}

func TestWrongKeysAreLimited(t *testing.T) {
	h := newHarness(t)
	const wrong = `{"room":"standup","name":"Ada","key":"wrong-key-wrong-key"}`
	for range keyFailuresPer10Minutes {
		expectError(t, h.post("/api/join", wrong), http.StatusUnauthorized, "invalid_key")
	}
	expectError(t, h.post("/api/join", wrong), http.StatusTooManyRequests, "rate_limited")
	// Even the right key is refused from that address until the window passes.
	expectError(t, h.post("/api/join", `{"room":"standup","name":"Ada","key":"`+memberKey+`"}`),
		http.StatusTooManyRequests, "rate_limited")
	// Guests are unaffected.
	h.lk.presence = rtc.Presence{MemberPresent: true}
	if rec := h.post("/api/join", `{"room":"standup","name":"Ada"}`); rec.Code != http.StatusOK {
		t.Errorf("guest join status = %d", rec.Code)
	}
}

func TestRequestsAreLimited(t *testing.T) {
	h := newHarness(t)
	h.lk.presence = rtc.Presence{MemberPresent: true}
	for i := range requestsPerMinute {
		if rec := h.post("/api/join", `{"room":"standup","name":"Ada"}`); rec.Code != http.StatusOK {
			t.Fatalf("request %d: status %d", i+1, rec.Code)
		}
	}
	expectError(t, h.post("/api/join", `{"room":"standup","name":"Ada"}`), http.StatusTooManyRequests, "rate_limited")
}

func TestClientIP(t *testing.T) {
	tests := []struct {
		name  string
		trust bool
		xff   string
		want  string
	}{
		{"direct", false, "", "192.0.2.1"},
		{"header ignored when not trusted", false, "203.0.113.9", "192.0.2.1"},
		{"last entry when trusted", true, "6.6.6.6, 203.0.113.9", "203.0.113.9"},
		{"single entry when trusted", true, "203.0.113.9", "203.0.113.9"},
		{"no header when trusted", true, "", "192.0.2.1"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newHarness(t, func(c *config.Config) { c.TrustProxyHeaders = tt.trust })
			s := New(Options{Config: config.Config{TrustProxyHeaders: tt.trust}, LiveKit: h.lk})
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.RemoteAddr = "192.0.2.1:5555"
			if tt.xff != "" {
				req.Header.Set("X-Forwarded-For", tt.xff)
			}
			if got := s.clientIP(req); got != tt.want {
				t.Errorf("clientIP = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestMemberActions(t *testing.T) {
	h := newHarness(t)
	auth := []string{"Authorization", bearer(memberKey)}

	if rec := h.post("/api/rooms/standup/kick", `{"identity":"p_abc"}`, auth...); rec.Code != http.StatusNoContent {
		t.Fatalf("kick status = %d: %s", rec.Code, rec.Body.String())
	}
	if len(h.lk.removed) != 1 || h.lk.removed[0] != "standup/p_abc" {
		t.Errorf("removed = %v", h.lk.removed)
	}

	if rec := h.post("/api/rooms/standup/end", "", auth...); rec.Code != http.StatusNoContent {
		t.Fatalf("end status = %d: %s", rec.Code, rec.Body.String())
	}
	if len(h.lk.ended) != 1 || h.lk.ended[0] != "standup" {
		t.Errorf("ended = %v", h.lk.ended)
	}

	if rec := h.post("/api/rooms/standup/lock", `{"locked":true}`, auth...); rec.Code != http.StatusNoContent {
		t.Fatalf("lock status = %d: %s", rec.Code, rec.Body.String())
	}
	if rec := h.post("/api/rooms/standup/lock", `{"locked":false}`, auth...); rec.Code != http.StatusNoContent {
		t.Fatalf("unlock status = %d: %s", rec.Code, rec.Body.String())
	}
	if len(h.lk.locked) != 2 || !h.lk.locked[0] || h.lk.locked[1] {
		t.Errorf("locked = %v", h.lk.locked)
	}
}

func TestMute(t *testing.T) {
	h := newHarness(t)
	auth := []string{"Authorization", bearer(memberKey)}

	rec := h.post("/api/rooms/standup/mute", `{"identity":"p_123"}`, auth...)
	if rec.Code != http.StatusOK || decode[muteResponse](t, rec).Muted != 1 {
		t.Errorf("mute one: %d %s", rec.Code, rec.Body.String())
	}
	if len(h.lk.mutedOne) != 1 || h.lk.mutedOne[0] != "standup/p_123" {
		t.Errorf("mutedOne = %v", h.lk.mutedOne)
	}

	h.lk.guestsMuted = 4
	rec = h.post("/api/rooms/standup/mute", `{"all":true}`, auth...)
	if rec.Code != http.StatusOK || decode[muteResponse](t, rec).Muted != 4 {
		t.Errorf("mute all: %d %s", rec.Code, rec.Body.String())
	}
	if len(h.lk.mutedAll) != 1 || h.lk.mutedAll[0] != "standup" {
		t.Errorf("mutedAll = %v", h.lk.mutedAll)
	}
}

func TestMuteNeedsAKeyAndOneTarget(t *testing.T) {
	h := newHarness(t)
	expectError(t, h.post("/api/rooms/standup/mute", `{"all":true}`), http.StatusUnauthorized, "invalid_key")
	expectError(t, h.post("/api/rooms/standup/mute", `{"all":true}`, "Authorization", bearer("wrong-key-wrong-key")), http.StatusUnauthorized, "invalid_key")

	auth := []string{"Authorization", bearer(memberKey)}
	for _, body := range []string{`{}`, `{"identity":"p_1","all":true}`, `{"identity":"` + strings.Repeat("x", 129) + `"}`} {
		expectError(t, h.post("/api/rooms/standup/mute", body, auth...), http.StatusBadRequest, "invalid_target")
	}
	expectError(t, h.post("/api/rooms/a_b/mute", `{"all":true}`, auth...), http.StatusBadRequest, "invalid_room")
	if len(h.lk.mutedOne)+len(h.lk.mutedAll) != 0 {
		t.Error("something was muted by an invalid request")
	}

	h.lk.actionErr = rtc.ErrNotFound
	expectError(t, h.post("/api/rooms/standup/mute", `{"all":true}`, auth...), http.StatusNotFound, "not_found")
}

func TestMemberActionsRequireKey(t *testing.T) {
	h := newHarness(t)
	endpoints := map[string]string{
		"/api/rooms/standup/kick": `{"identity":"p_abc"}`,
		"/api/rooms/standup/end":  "",
		"/api/rooms/standup/lock": `{"locked":true}`,
	}
	for path, body := range endpoints {
		t.Run(path, func(t *testing.T) {
			expectError(t, h.post(path, body), http.StatusUnauthorized, "invalid_key")
			expectError(t, h.post(path, body, "Authorization", bearer("wrong-key-wrong-key")), http.StatusUnauthorized, "invalid_key")
			expectError(t, h.post(path, body, "Authorization", "Basic "+memberKey), http.StatusUnauthorized, "invalid_key")
		})
	}
	if len(h.lk.removed)+len(h.lk.ended)+len(h.lk.locked) != 0 {
		t.Error("an action ran without a valid key")
	}
}

func TestMemberActionValidation(t *testing.T) {
	h := newHarness(t)
	auth := []string{"Authorization", bearer(memberKey)}
	expectError(t, h.post("/api/rooms/x/end", "", auth...), http.StatusBadRequest, "invalid_room")
	expectError(t, h.post("/api/rooms/standup/kick", `{}`, auth...), http.StatusBadRequest, "invalid_identity")
	expectError(t, h.post("/api/rooms/standup/kick", `{"identity":"`+strings.Repeat("x", 129)+`"}`, auth...), http.StatusBadRequest, "invalid_identity")
	expectError(t, h.post("/api/rooms/standup/lock", `{"locked":"yes"}`, auth...), http.StatusBadRequest, "bad_request")
}

func TestMemberActionLiveKitErrors(t *testing.T) {
	h := newHarness(t)
	auth := []string{"Authorization", bearer(memberKey)}

	h.lk.actionErr = rtc.ErrNotFound
	expectError(t, h.post("/api/rooms/standup/kick", `{"identity":"p_abc"}`, auth...), http.StatusNotFound, "not_found")
	expectError(t, h.post("/api/rooms/standup/end", "", auth...), http.StatusNotFound, "not_found")

	h.lk.actionErr = errors.New("boom")
	expectError(t, h.post("/api/rooms/standup/end", "", auth...), http.StatusBadGateway, "unavailable")
}

func TestStatic(t *testing.T) {
	h := newHarness(t)

	for _, path := range []string{"/", "/standup", "/some-room-name", "/standup/", "/index.html", "/assets", "/missing.txt"} {
		rec := h.do(http.MethodGet, path, "")
		if rec.Code != http.StatusOK || rec.Body.String() != "<html>app</html>" {
			t.Errorf("GET %s = %d %q, want the index page", path, rec.Code, rec.Body.String())
		}
		if cc := rec.Header().Get("Cache-Control"); cc != "no-cache" {
			t.Errorf("GET %s Cache-Control = %q", path, cc)
		}
	}

	rec := h.do(http.MethodGet, "/assets/app-1.js", "")
	if rec.Code != http.StatusOK || rec.Body.String() != "console.log(1)" {
		t.Errorf("asset = %d %q", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Header().Get("Cache-Control"), "immutable") {
		t.Errorf("assets should be cached forever, got %q", rec.Header().Get("Cache-Control"))
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "javascript") {
		t.Errorf("asset Content-Type = %q", ct)
	}

	if rec := h.do(http.MethodGet, "/favicon.svg", ""); rec.Code != http.StatusOK || rec.Body.String() != "<svg/>" {
		t.Errorf("favicon = %d %q", rec.Code, rec.Body.String())
	}
	if rec := h.do(http.MethodHead, "/standup", ""); rec.Code != http.StatusOK {
		t.Errorf("HEAD status = %d", rec.Code)
	}
	// The router cleans traversal attempts, and the cleaned path is just a room.
	rec = h.do(http.MethodGet, "/../../etc/passwd", "")
	if rec.Code < 300 || rec.Code > 399 || rec.Header().Get("Location") != "/etc/passwd" {
		t.Errorf("traversal = %d to %q, want a redirect to the cleaned path", rec.Code, rec.Header().Get("Location"))
	}
	if rec := h.do(http.MethodGet, "/etc/passwd", ""); rec.Body.String() != "<html>app</html>" {
		t.Errorf("/etc/passwd served %q", rec.Body.String())
	}
}

func TestStaticWithoutBuiltApp(t *testing.T) {
	h := newHarness(t)
	s := New(Options{Config: config.Config{}, LiveKit: h.lk, Assets: fstest.MapFS{}})
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/standup", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503", rec.Code)
	}
}

func TestAPINotFound(t *testing.T) {
	h := newHarness(t)
	expectError(t, h.do(http.MethodGet, "/api/nothing", ""), http.StatusNotFound, "not_found")
	if rec := h.do(http.MethodGet, "/api/join", ""); rec.Code != http.StatusNotFound {
		// Unsupported methods on API paths are refused, not served the app.
		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("GET /api/join status = %d", rec.Code)
		}
	}
}

func TestHealthz(t *testing.T) {
	h := newHarness(t)
	rec := h.do(http.MethodGet, "/healthz", "")
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != "ok" {
		t.Errorf("healthz = %d %q", rec.Code, rec.Body.String())
	}
}

func TestSecurityHeaders(t *testing.T) {
	h := newHarness(t)
	rec := h.do(http.MethodGet, "/standup", "")
	csp := rec.Header().Get("Content-Security-Policy")
	for _, want := range []string{
		"default-src 'self'",
		"connect-src 'self' wss://rtc.example.com https://rtc.example.com",
		"frame-ancestors 'none'",
		"worker-src 'self' blob:",
	} {
		if !strings.Contains(csp, want) {
			t.Errorf("CSP %q does not contain %q", csp, want)
		}
	}
	for header, want := range map[string]string{
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options":        "DENY",
		"Referrer-Policy":        "no-referrer",
	} {
		if got := rec.Header().Get(header); got != want {
			t.Errorf("%s = %q, want %q", header, got, want)
		}
	}
	if pp := rec.Header().Get("Permissions-Policy"); !strings.Contains(pp, "camera=(self)") || !strings.Contains(pp, "display-capture=(self)") {
		t.Errorf("Permissions-Policy = %q", pp)
	}
	if got := h.post("/api/join", "{}").Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("API responses should not be cached, got %q", got)
	}
}

func TestPanicIsRecovered(t *testing.T) {
	h := newHarness(t)
	s := New(Options{Config: config.Config{}, LiveKit: h.lk})
	handler := s.recoverer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { panic("boom") }))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	expectError(t, rec, http.StatusInternalServerError, "internal")
}

func TestNormalizeRoom(t *testing.T) {
	valid := map[string]string{
		"standup":               "standup",
		"  StandUp ":            "standup",
		"abc":                   "abc",
		"a-b-c":                 "a-b-c",
		"kfj-2hd-9xq":           "kfj-2hd-9xq",
		strings.Repeat("a", 48): strings.Repeat("a", 48),
	}
	for in, want := range valid {
		if got, ok := normalizeRoom(in); !ok || got != want {
			t.Errorf("normalizeRoom(%q) = %q, %v; want %q", in, got, ok, want)
		}
	}
	for _, in := range []string{"", "ab", "abc-", "-abc", "a--c", "ab_c", "ab c", "ab.c", "ab/c", "é-é-é", strings.Repeat("a", 49)} {
		if got, ok := normalizeRoom(in); ok {
			t.Errorf("normalizeRoom(%q) = %q, want it rejected", in, got)
		}
	}
}
