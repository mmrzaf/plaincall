package config

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	ListenAddr        string
	PublicURL         string
	LiveKitURL        string
	LiveKitAPIKey     string
	LiveKitAPISecret  string
	RoomSigningSecret string
	RoomTTL           time.Duration
	TokenTTL          time.Duration
	TrustProxyHeaders bool
	AllowedOrigins    map[string]struct{}
	Dev               bool
}

func Load() (Config, error) {
	dev := boolEnv("PLAINCALL_DEV", false)
	port := env("PLAINCALL_PORT", "8080")
	cfg := Config{
		ListenAddr:        ":" + port,
		PublicURL:         env("PLAINCALL_PUBLIC_URL", devDefault(dev, "http://localhost:"+port, "")),
		LiveKitURL:        env("LIVEKIT_PUBLIC_URL", devDefault(dev, "ws://localhost:7880", "")),
		LiveKitAPIKey:     env("LIVEKIT_API_KEY", devDefault(dev, "devkey", "")),
		LiveKitAPISecret:  env("LIVEKIT_API_SECRET", devDefault(dev, "secret", "")),
		RoomSigningSecret: env("PLAINCALL_SECRET_KEY", devDefault(dev, "plaincall-dev-room-signing-secret-1234", "")),
		RoomTTL:           durationEnv("PLAINCALL_ROOM_TTL", 24*time.Hour),
		TokenTTL:          durationEnv("PLAINCALL_TOKEN_TTL", 30*time.Minute),
		TrustProxyHeaders: boolEnv("PLAINCALL_TRUST_PROXY_HEADERS", false),
		Dev:               dev,
	}

	if err := cfg.validate(); err != nil {
		return Config{}, err
	}
	cfg.AllowedOrigins = allowedOrigins(cfg.PublicURL, os.Getenv("PLAINCALL_ALLOWED_ORIGINS"))
	return cfg, nil
}

func (c Config) validate() error {
	if c.PublicURL == "" {
		return fmt.Errorf("PLAINCALL_PUBLIC_URL is required")
	}
	publicURL, err := url.Parse(c.PublicURL)
	if err != nil || publicURL.Host == "" || (publicURL.Scheme != "http" && publicURL.Scheme != "https") {
		return fmt.Errorf("PLAINCALL_PUBLIC_URL must be an absolute http or https URL")
	}
	if publicURL.Path != "" && publicURL.Path != "/" {
		return fmt.Errorf("PLAINCALL_PUBLIC_URL must not include a path")
	}

	if c.LiveKitURL == "" {
		return fmt.Errorf("LIVEKIT_PUBLIC_URL is required")
	}
	liveKitURL, err := url.Parse(c.LiveKitURL)
	if err != nil || liveKitURL.Host == "" || (liveKitURL.Scheme != "ws" && liveKitURL.Scheme != "wss") {
		return fmt.Errorf("LIVEKIT_PUBLIC_URL must be an absolute ws or wss URL")
	}
	if c.LiveKitAPIKey == "" {
		return fmt.Errorf("LIVEKIT_API_KEY is required")
	}
	if !c.Dev && len(c.LiveKitAPISecret) < 32 {
		return fmt.Errorf("LIVEKIT_API_SECRET must be at least 32 characters")
	}
	if !c.Dev && len(c.RoomSigningSecret) < 32 {
		return fmt.Errorf("PLAINCALL_SECRET_KEY must be at least 32 characters")
	}
	if c.RoomTTL <= 0 {
		return fmt.Errorf("PLAINCALL_ROOM_TTL must be positive")
	}
	if c.TokenTTL <= 0 || c.TokenTTL > 24*time.Hour {
		return fmt.Errorf("PLAINCALL_TOKEN_TTL must be positive and no more than 24h")
	}
	return nil
}

func allowedOrigins(publicURL, raw string) map[string]struct{} {
	origins := map[string]struct{}{strings.TrimSuffix(publicURL, "/"): {}}
	for _, item := range strings.Split(raw, ",") {
		item = strings.TrimSpace(strings.TrimSuffix(item, "/"))
		if item != "" {
			origins[item] = struct{}{}
		}
	}
	return origins
}

func env(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func devDefault(dev bool, value, fallback string) string {
	if dev {
		return value
	}
	return fallback
}

func durationEnv(name string, fallback time.Duration) time.Duration {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return -1
	}
	return parsed
}

func boolEnv(name string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}
