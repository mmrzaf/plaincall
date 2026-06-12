package httpapi

import (
	"encoding/json"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/mmrzaf/plaincall/internal/config"
)

func TestCreateRoomThenIssueToken(t *testing.T) {
	handler := testServer(t).Handler()

	create := httptest.NewRequest(http.MethodPost, "/api/rooms", strings.NewReader(`{}`))
	create.Header.Set("Content-Type", "application/json")
	create.Header.Set("Origin", "https://call.example.com")
	createResponse := httptest.NewRecorder()
	handler.ServeHTTP(createResponse, create)
	if createResponse.Code != http.StatusCreated {
		t.Fatalf("POST /api/rooms status = %d, want %d: %s", createResponse.Code, http.StatusCreated, createResponse.Body.String())
	}
	var room struct {
		Room string `json:"room"`
		URL  string `json:"url"`
	}
	if err := json.NewDecoder(createResponse.Body).Decode(&room); err != nil {
		t.Fatalf("decode create room response: %v", err)
	}
	if room.Room == "" || !strings.Contains(room.URL, room.Room) {
		t.Fatalf("unexpected room response: %#v", room)
	}

	joinBody := `{"room_name":"` + room.Room + `","participant_name":"  Alice   Example "}`
	join := httptest.NewRequest(http.MethodPost, "/api/token", strings.NewReader(joinBody))
	join.Header.Set("Content-Type", "application/json")
	join.Header.Set("Origin", "https://call.example.com")
	joinResponse := httptest.NewRecorder()
	handler.ServeHTTP(joinResponse, join)
	if joinResponse.Code != http.StatusCreated {
		t.Fatalf("POST /api/token status = %d, want %d: %s", joinResponse.Code, http.StatusCreated, joinResponse.Body.String())
	}
	var token tokenResponse
	if err := json.NewDecoder(joinResponse.Body).Decode(&token); err != nil {
		t.Fatalf("decode token response: %v", err)
	}
	if token.ServerURL != "wss://rtc.example.com" || strings.Count(token.ParticipantToken, ".") != 2 {
		t.Fatalf("unexpected token response: %#v", token)
	}
}

func TestIssueTokenRejectsUnknownRoomAndOrigin(t *testing.T) {
	handler := testServer(t).Handler()

	request := httptest.NewRequest(http.MethodPost, "/api/token", strings.NewReader(`{"room_name":"r_invalid","participant_name":"Alice"}`))
	request.Header.Set("Origin", "https://call.example.com")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("invalid room status = %d, want %d", response.Code, http.StatusBadRequest)
	}

	request = httptest.NewRequest(http.MethodPost, "/api/rooms", strings.NewReader(`{}`))
	request.Header.Set("Origin", "https://evil.example")
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("invalid origin status = %d, want %d", response.Code, http.StatusForbidden)
	}
}

func TestHealthAndSPAFallback(t *testing.T) {
	handler := testServer(t).Handler()

	health := httptest.NewRecorder()
	handler.ServeHTTP(health, httptest.NewRequest(http.MethodGet, "/health", nil))
	if health.Code != http.StatusOK || health.Body.String() != "ok\n" {
		t.Fatalf("GET /health = %d %q", health.Code, health.Body.String())
	}

	page := httptest.NewRecorder()
	handler.ServeHTTP(page, httptest.NewRequest(http.MethodGet, "/r/example", nil))
	if page.Code != http.StatusOK || !strings.Contains(page.Body.String(), "PlainCall") {
		t.Fatalf("GET /r/example = %d %q", page.Code, page.Body.String())
	}
}

func testServer(t *testing.T) *Server {
	t.Helper()
	files := fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("<!doctype html><title>PlainCall</title>")},
	}
	var static fs.FS = files
	cfg := config.Config{
		ListenAddr:        ":0",
		PublicURL:         "https://call.example.com",
		LiveKitURL:        "wss://rtc.example.com",
		LiveKitAPIKey:     "api-key",
		LiveKitAPISecret:  "01234567890123456789012345678901",
		RoomSigningSecret: "abcdefghijklmnopqrstuvwxyz123456",
		RoomTTL:           time.Hour,
		TokenTTL:          30 * time.Minute,
		AllowedOrigins: map[string]struct{}{
			"https://call.example.com": {},
		},
	}
	return New(cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), static)
}
