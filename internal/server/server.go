// Package server implements PlainCall's HTTP interface: the join and
// room-management API and the embedded web app.
package server

import (
	"context"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/mmrzaf/plaincall/internal/config"
	"github.com/mmrzaf/plaincall/internal/ratelimit"
	"github.com/mmrzaf/plaincall/internal/rtc"
)

const (
	// Requests to the API allowed per client address each minute.
	requestsPerMinute = 120
	// Wrong keys allowed per client address every ten minutes.
	keyFailuresPer10Minutes = 10
)

// LiveKit is what the server needs from the media server.
type LiveKit interface {
	JoinToken(room, name string, role rtc.Role) (string, error)
	Presence(ctx context.Context, room string) (rtc.Presence, error)
	Remove(ctx context.Context, room, identity string) error
	End(ctx context.Context, room string) error
	SetLocked(ctx context.Context, room string, locked bool) error
}

// Options configures a Server.
type Options struct {
	Config  config.Config
	LiveKit LiveKit
	// Assets holds the built web app, with index.html at its root.
	Assets fs.FS
	Logger *slog.Logger
}

// Server is PlainCall's HTTP handler.
type Server struct {
	cfg      config.Config
	lk       LiveKit
	assets   fs.FS
	log      *slog.Logger
	requests *ratelimit.Limiter
	failures *ratelimit.Limiter
}

// New returns a Server.
func New(opts Options) *Server {
	logger := opts.Logger
	if logger == nil {
		logger = slog.New(slog.DiscardHandler)
	}
	return &Server{
		cfg:      opts.Config,
		lk:       opts.LiveKit,
		assets:   opts.Assets,
		log:      logger,
		requests: ratelimit.New(requestsPerMinute, time.Minute),
		failures: ratelimit.New(keyFailuresPer10Minutes, 10*time.Minute),
	}
}

// Handler returns the HTTP handler for the whole application.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.healthz)
	mux.HandleFunc("POST /api/join", s.limited(s.join))
	mux.HandleFunc("POST /api/rooms/{room}/kick", s.limited(s.kick))
	mux.HandleFunc("POST /api/rooms/{room}/end", s.limited(s.end))
	mux.HandleFunc("POST /api/rooms/{room}/lock", s.limited(s.lock))
	mux.HandleFunc("GET /", s.static)
	return s.recoverer(s.securityHeaders(s.logRequests(mux)))
}

// clientIP returns the address used to rate-limit a request.
func (s *Server) clientIP(r *http.Request) string {
	if s.cfg.TrustProxyHeaders {
		if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
			// The last entry is the one added by our own proxy; earlier
			// entries are supplied by the client and cannot be trusted.
			parts := strings.Split(forwarded, ",")
			if ip := strings.TrimSpace(parts[len(parts)-1]); ip != "" {
				return ip
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
