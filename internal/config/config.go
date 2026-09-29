// Package config loads PlainCall's settings from environment variables.
package config

import (
	"errors"
	"fmt"
	"net/url"
	"slices"
	"strconv"
	"strings"
)

// Limits for PLAINCALL_MAX_PARTICIPANTS.
const (
	DefaultMaxParticipants = 20
	MinMaxParticipants     = 2
	MaxMaxParticipants     = 500
)

// Config holds every setting the server needs.
type Config struct {
	// Addr is the address the HTTP server listens on.
	Addr string
	// TrustProxyHeaders makes the server take the client address from the
	// last X-Forwarded-For entry. Enable it only behind a reverse proxy.
	TrustProxyHeaders bool
	// MaxParticipants is how many people one room holds.
	MaxParticipants int
	// Keys are the member keys.
	Keys Keys
	// LiveKitURL is the public WebSocket URL browsers connect to.
	LiveKitURL string
	// LiveKitAPIURL is the HTTP URL this server uses to call LiveKit.
	LiveKitAPIURL string
	// LiveKitAPIKey and LiveKitAPISecret authenticate against LiveKit.
	LiveKitAPIKey    string
	LiveKitAPISecret string
}

// Load reads the configuration through getenv, which is normally os.Getenv.
// All problems are reported together.
func Load(getenv func(string) string) (Config, error) {
	var errs []error
	fail := func(format string, args ...any) { errs = append(errs, fmt.Errorf(format, args...)) }
	get := func(name string) string { return strings.TrimSpace(getenv(name)) }

	cfg := Config{
		Addr:             get("PLAINCALL_ADDR"),
		LiveKitURL:       strings.TrimRight(get("LIVEKIT_URL"), "/"),
		LiveKitAPIURL:    strings.TrimRight(get("LIVEKIT_API_URL"), "/"),
		LiveKitAPIKey:    get("LIVEKIT_API_KEY"),
		LiveKitAPISecret: get("LIVEKIT_API_SECRET"),
	}
	if cfg.Addr == "" {
		cfg.Addr = ":8080"
	}

	cfg.MaxParticipants = DefaultMaxParticipants
	if raw := get("PLAINCALL_MAX_PARTICIPANTS"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < MinMaxParticipants || n > MaxMaxParticipants {
			fail("PLAINCALL_MAX_PARTICIPANTS must be a number from %d to %d", MinMaxParticipants, MaxMaxParticipants)
		} else {
			cfg.MaxParticipants = n
		}
	}

	if raw := get("PLAINCALL_TRUST_PROXY_HEADERS"); raw != "" {
		trust, err := strconv.ParseBool(raw)
		if err != nil {
			fail("PLAINCALL_TRUST_PROXY_HEADERS must be true or false")
		}
		cfg.TrustProxyHeaders = trust
	}

	keys, err := ParseKeys(getenv("PLAINCALL_KEYS"))
	if err != nil {
		fail("PLAINCALL_KEYS: %v", err)
	}
	cfg.Keys = keys

	switch {
	case cfg.LiveKitURL == "":
		fail("LIVEKIT_URL is required")
	case !validURL(cfg.LiveKitURL, "ws", "wss"):
		fail("LIVEKIT_URL must be an absolute ws:// or wss:// URL")
	case cfg.LiveKitAPIURL == "":
		cfg.LiveKitAPIURL = httpURL(cfg.LiveKitURL)
	}
	if cfg.LiveKitAPIURL != "" && !validURL(cfg.LiveKitAPIURL, "http", "https") {
		fail("LIVEKIT_API_URL must be an absolute http:// or https:// URL")
	}

	if cfg.LiveKitAPIKey == "" {
		fail("LIVEKIT_API_KEY is required")
	}
	if cfg.LiveKitAPISecret == "" {
		fail("LIVEKIT_API_SECRET is required")
	}

	if err := errors.Join(errs...); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// ConnectSources returns the origins a browser needs to reach LiveKit, for use
// in a Content-Security-Policy connect-src directive.
func (c Config) ConnectSources() []string {
	return []string{c.LiveKitURL, httpURL(c.LiveKitURL)}
}

func validURL(raw string, schemes ...string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return false
	}
	return slices.Contains(schemes, u.Scheme)
}

// httpURL converts a ws(s) URL to its http(s) equivalent.
func httpURL(raw string) string {
	switch {
	case strings.HasPrefix(raw, "wss://"):
		return "https://" + strings.TrimPrefix(raw, "wss://")
	case strings.HasPrefix(raw, "ws://"):
		return "http://" + strings.TrimPrefix(raw, "ws://")
	}
	return raw
}
