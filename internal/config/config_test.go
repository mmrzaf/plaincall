package config

import "testing"

func TestLoadDevelopmentDefaults(t *testing.T) {
	t.Setenv("PLAINCALL_DEV", "true")
	t.Setenv("PLAINCALL_PUBLIC_URL", "")
	t.Setenv("LIVEKIT_PUBLIC_URL", "")
	t.Setenv("LIVEKIT_API_KEY", "")
	t.Setenv("LIVEKIT_API_SECRET", "")
	t.Setenv("PLAINCALL_SECRET_KEY", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.PublicURL != "http://localhost:8080" || cfg.LiveKitURL != "ws://localhost:7880" {
		t.Fatalf("unexpected development URLs: %#v", cfg)
	}
	if cfg.LiveKitAPIKey != "devkey" || cfg.LiveKitAPISecret != "secret" {
		t.Fatalf("unexpected development LiveKit credentials: %#v", cfg)
	}
}

func TestLoadProductionRequiresConfiguration(t *testing.T) {
	t.Setenv("PLAINCALL_DEV", "false")
	t.Setenv("PLAINCALL_PUBLIC_URL", "")
	t.Setenv("LIVEKIT_PUBLIC_URL", "")
	t.Setenv("LIVEKIT_API_KEY", "")
	t.Setenv("LIVEKIT_API_SECRET", "")
	t.Setenv("PLAINCALL_SECRET_KEY", "")

	if _, err := Load(); err == nil {
		t.Fatal("Load() accepted incomplete production configuration")
	}
}
