package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/mmrzaf/plaincall/internal/config"
	"github.com/mmrzaf/plaincall/internal/livekittoken"
	"github.com/mmrzaf/plaincall/internal/ratelimit"
	"github.com/mmrzaf/plaincall/internal/roomtoken"
)

const maxJSONBody = 4 << 10

type Server struct {
	cfg          config.Config
	logger       *slog.Logger
	rooms        *roomtoken.Manager
	tokens       *livekittoken.Issuer
	createLimit  *ratelimit.Limiter
	joinLimit    *ratelimit.Limiter
	staticFiles  fs.FS
	staticServer http.Handler
}

type createRoomResponse struct {
	Room      string `json:"room"`
	URL       string `json:"url"`
	ExpiresAt string `json:"expires_at"`
}

type tokenRequest struct {
	RoomName        string `json:"room_name"`
	ParticipantName string `json:"participant_name"`
}

type tokenResponse struct {
	ServerURL        string `json:"server_url"`
	ParticipantToken string `json:"participant_token"`
}

type errorResponse struct {
	Error string `json:"error"`
}

func New(cfg config.Config, logger *slog.Logger, staticFiles fs.FS) *Server {
	return &Server{
		cfg:          cfg,
		logger:       logger,
		rooms:        roomtoken.New(cfg.RoomSigningSecret, cfg.RoomTTL),
		tokens:       livekittoken.New(cfg.LiveKitAPIKey, cfg.LiveKitAPISecret, cfg.TokenTTL),
		createLimit:  ratelimit.New(20, time.Minute, 4096),
		joinLimit:    ratelimit.New(120, time.Minute, 8192),
		staticFiles:  staticFiles,
		staticServer: http.FileServer(http.FS(staticFiles)),
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.health)
	mux.HandleFunc("POST /api/rooms", s.createRoom)
	mux.HandleFunc("POST /api/token", s.issueToken)
	mux.HandleFunc("GET /", s.serveWeb)
	return s.recoverer(s.securityHeaders(s.requestLogger(mux)))
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = io.WriteString(w, "ok\n")
}

func (s *Server) createRoom(w http.ResponseWriter, r *http.Request) {
	if !s.originAllowed(r) {
		writeJSON(w, http.StatusForbidden, errorResponse{Error: "origin is not allowed"})
		return
	}
	if !s.createLimit.Allow(s.clientIP(r)) {
		writeJSON(w, http.StatusTooManyRequests, errorResponse{Error: "too many room requests"})
		return
	}

	room, expiresAt, err := s.rooms.Create()
	if err != nil {
		s.logger.Error("create room link", "error", err)
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: "could not create room"})
		return
	}

	writeJSON(w, http.StatusCreated, createRoomResponse{
		Room:      room,
		URL:       strings.TrimSuffix(s.cfg.PublicURL, "/") + "/r/" + url.PathEscape(room),
		ExpiresAt: expiresAt.UTC().Format(time.RFC3339),
	})
}

func (s *Server) issueToken(w http.ResponseWriter, r *http.Request) {
	if !s.originAllowed(r) {
		writeJSON(w, http.StatusForbidden, errorResponse{Error: "origin is not allowed"})
		return
	}
	if !s.joinLimit.Allow(s.clientIP(r)) {
		writeJSON(w, http.StatusTooManyRequests, errorResponse{Error: "too many join requests"})
		return
	}

	var request tokenRequest
	if err := decodeJSON(w, r, &request); err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: err.Error()})
		return
	}

	request.RoomName = strings.TrimSpace(request.RoomName)
	request.ParticipantName = normalizeName(request.ParticipantName)
	if err := s.rooms.Verify(request.RoomName); err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: "room link is invalid or expired"})
		return
	}
	if err := validateDisplayName(request.ParticipantName); err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: err.Error()})
		return
	}

	token, _, err := s.tokens.Issue(request.RoomName, request.ParticipantName)
	if err != nil {
		s.logger.Error("issue participant token", "error", err)
		writeJSON(w, http.StatusInternalServerError, errorResponse{Error: "could not join room"})
		return
	}

	writeJSON(w, http.StatusCreated, tokenResponse{
		ServerURL:        s.cfg.LiveKitURL,
		ParticipantToken: token,
	})
}

func (s *Server) serveWeb(w http.ResponseWriter, r *http.Request) {
	requested := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if requested == "." || requested == "" {
		requested = "index.html"
	}

	if file, err := s.staticFiles.Open(requested); err == nil {
		_ = file.Close()
		if strings.HasPrefix(requested, "assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		s.staticServer.ServeHTTP(w, r)
		return
	}

	if strings.HasPrefix(r.URL.Path, "/api/") {
		http.NotFound(w, r)
		return
	}

	index, err := fs.ReadFile(s.staticFiles, "index.html")
	if err != nil {
		http.Error(w, "frontend unavailable", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", mime.TypeByExtension(".html"))
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(index)
}

func (s *Server) originAllowed(r *http.Request) bool {
	origin := strings.TrimSuffix(strings.TrimSpace(r.Header.Get("Origin")), "/")
	if origin == "" {
		return true
	}
	_, ok := s.cfg.AllowedOrigins[origin]
	return ok
}

func (s *Server) clientIP(r *http.Request) string {
	if s.cfg.TrustProxyHeaders {
		if forwarded := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); forwarded != "" {
			if first, _, ok := strings.Cut(forwarded, ","); ok {
				return strings.TrimSpace(first)
			}
			return forwarded
		}
		if realIP := strings.TrimSpace(r.Header.Get("X-Real-IP")); realIP != "" {
			return realIP
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Permissions-Policy", "camera=(self), microphone=(self), display-capture=(self)")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
		next.ServeHTTP(w, r)
	})
}

func (s *Server) requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(recorder, r)
		if r.URL.Path == "/health" {
			return
		}
		s.logger.Info("http request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", recorder.status,
			"duration_ms", time.Since(started).Milliseconds(),
			"client_ip", s.clientIP(r),
		)
	})
}

func (s *Server) recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				s.logger.Error("panic recovered", "error", recovered)
				writeJSON(w, http.StatusInternalServerError, errorResponse{Error: "internal server error"})
			}
		}()
		next.ServeHTTP(w, r)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (w *statusRecorder) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func decodeJSON(w http.ResponseWriter, r *http.Request, destination any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBody)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return fmt.Errorf("invalid request body")
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return fmt.Errorf("request body must contain one JSON object")
	}
	return nil
}

func normalizeName(name string) string {
	return strings.Join(strings.Fields(name), " ")
}

func validateDisplayName(name string) error {
	if name == "" {
		return fmt.Errorf("display name is required")
	}
	if !utf8.ValidString(name) {
		return fmt.Errorf("display name must be valid UTF-8")
	}
	if utf8.RuneCountInString(name) > 48 {
		return fmt.Errorf("display name must be 48 characters or fewer")
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func ListenAndServe(ctx context.Context, cfg config.Config, logger *slog.Logger, handler http.Handler) error {
	server := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		logger.Info("plaincall listening", "addr", cfg.ListenAddr, "public_url", cfg.PublicURL, "livekit_url", cfg.LiveKitURL)
		errCh <- server.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return server.Shutdown(shutdownCtx)
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}
