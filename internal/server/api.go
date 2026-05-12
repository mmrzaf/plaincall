package server

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"

	"github.com/mmrzaf/plaincall/internal/rtc"
)

const maxBodyBytes = 4 << 10

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type joinRequest struct {
	Room string `json:"room"`
	Name string `json:"name"`
	Key  string `json:"key"`
}

type joinResponse struct {
	URL   string   `json:"url"`
	Token string   `json:"token"`
	Role  rtc.Role `json:"role"`
}

type kickRequest struct {
	Identity string `json:"identity"`
}

type lockRequest struct {
	Locked bool `json:"locked"`
}

// limited applies the per-address request limit to an API handler.
func (s *Server) limited(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.requests.Allow(s.clientIP(r)) {
			writeError(w, http.StatusTooManyRequests, "rate_limited", "Too many requests. Wait a moment and try again.")
			return
		}
		next(w, r)
	}
}

// join issues a LiveKit token. Members present a key. Guests are admitted only
// while a member is in the room and the room is not locked.
func (s *Server) join(w http.ResponseWriter, r *http.Request) {
	var req joinRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	room, ok := normalizeRoom(req.Room)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_room", "Room names use 3 to 48 letters, digits and hyphens.")
		return
	}
	name, ok := cleanName(req.Name)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_name", "Enter a name of up to 40 characters.")
		return
	}

	role := rtc.RoleGuest
	if req.Key != "" {
		label, ok := s.authenticate(w, r, req.Key)
		if !ok {
			return
		}
		role = rtc.RoleMember
		s.log.Info("member joining", "room", room, "key", label)
	} else {
		presence, err := s.lk.Presence(r.Context(), room)
		if err != nil {
			s.livekitFailed(w, "check room", err)
			return
		}
		if presence.Locked {
			writeError(w, http.StatusForbidden, "room_locked", "This room is locked. Ask a host to unlock it.")
			return
		}
		if !presence.MemberPresent {
			writeError(w, http.StatusConflict, "waiting_for_host", "The host has not arrived yet.")
			return
		}
	}

	token, err := s.lk.JoinToken(room, name, role)
	if err != nil {
		s.log.Error("issue join token", "error", err)
		writeError(w, http.StatusInternalServerError, "internal", "Could not join the room.")
		return
	}
	writeJSON(w, http.StatusOK, joinResponse{URL: s.cfg.LiveKitURL, Token: token, Role: role})
}

func (s *Server) kick(w http.ResponseWriter, r *http.Request) {
	room, label, ok := s.memberRequest(w, r)
	if !ok {
		return
	}
	var req kickRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Identity == "" || len(req.Identity) > 128 {
		writeError(w, http.StatusBadRequest, "invalid_identity", "Choose a participant to remove.")
		return
	}
	if err := s.lk.Remove(r.Context(), room, req.Identity); err != nil {
		s.livekitFailed(w, "remove participant", err)
		return
	}
	s.log.Info("participant removed", "room", room, "key", label)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) end(w http.ResponseWriter, r *http.Request) {
	room, label, ok := s.memberRequest(w, r)
	if !ok {
		return
	}
	if err := s.lk.End(r.Context(), room); err != nil {
		s.livekitFailed(w, "end room", err)
		return
	}
	s.log.Info("room ended", "room", room, "key", label)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) lock(w http.ResponseWriter, r *http.Request) {
	room, label, ok := s.memberRequest(w, r)
	if !ok {
		return
	}
	var req lockRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if err := s.lk.SetLocked(r.Context(), room, req.Locked); err != nil {
		s.livekitFailed(w, "set room lock", err)
		return
	}
	s.log.Info("room lock changed", "room", room, "locked", req.Locked, "key", label)
	w.WriteHeader(http.StatusNoContent)
}

// memberRequest checks the room name in the path and the member key in the
// Authorization header. It writes the error response itself when either fails.
func (s *Server) memberRequest(w http.ResponseWriter, r *http.Request) (room, label string, ok bool) {
	room, ok = normalizeRoom(r.PathValue("room"))
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_room", "Room names use 3 to 48 letters, digits and hyphens.")
		return "", "", false
	}
	scheme, key, found := strings.Cut(r.Header.Get("Authorization"), " ")
	if !found || !strings.EqualFold(scheme, "Bearer") || strings.TrimSpace(key) == "" {
		writeError(w, http.StatusUnauthorized, "invalid_key", "A member key is required.")
		return "", "", false
	}
	label, ok = s.authenticate(w, r, strings.TrimSpace(key))
	return room, label, ok
}

// authenticate checks a member key. Repeated wrong keys from one address are
// refused for a while, so a key cannot be guessed by trial.
func (s *Server) authenticate(w http.ResponseWriter, r *http.Request, key string) (label string, ok bool) {
	ip := s.clientIP(r)
	if s.failures.Blocked(ip) {
		writeError(w, http.StatusTooManyRequests, "rate_limited", "Too many wrong keys. Try again later.")
		return "", false
	}
	label, ok = s.cfg.Keys.Match(key)
	if !ok {
		s.failures.Allow(ip)
		writeError(w, http.StatusUnauthorized, "invalid_key", "That key is not valid.")
		return "", false
	}
	return label, true
}

func (s *Server) livekitFailed(w http.ResponseWriter, action string, err error) {
	if errors.Is(err, rtc.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "That room or participant is no longer active.")
		return
	}
	s.log.Error("livekit request failed", "action", action, "error", err)
	writeError(w, http.StatusBadGateway, "unavailable", "The call server is not responding. Try again in a moment.")
}

// decodeJSON reads a small JSON object from the request body. It writes the
// error response itself and returns false when the body is unacceptable.
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	mediaType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if mediaType != "application/json" {
		writeError(w, http.StatusUnsupportedMediaType, "bad_request", "Send the request as application/json.")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "The request body is not valid.")
		return false
	}
	if _, err := decoder.Token(); !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "bad_request", "The request body is not valid.")
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, apiError{Code: code, Message: message})
}
