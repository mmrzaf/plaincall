package config

import (
	"strings"
	"testing"
)

func env(values map[string]string) func(string) string {
	return func(name string) string { return values[name] }
}

func validEnv() map[string]string {
	return map[string]string{
		"PLAINCALL_KEYS":     "alice:0123456789abcdef",
		"LIVEKIT_URL":        "wss://rtc.example.com/",
		"LIVEKIT_API_KEY":    "key",
		"LIVEKIT_API_SECRET": "secret",
	}
}

func TestLoadDefaults(t *testing.T) {
	cfg, err := Load(env(validEnv()))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Addr != ":8080" {
		t.Errorf("Addr = %q, want :8080", cfg.Addr)
	}
	if cfg.LiveKitURL != "wss://rtc.example.com" {
		t.Errorf("LiveKitURL = %q", cfg.LiveKitURL)
	}
	if cfg.LiveKitAPIURL != "https://rtc.example.com" {
		t.Errorf("LiveKitAPIURL = %q, want the https form of LIVEKIT_URL", cfg.LiveKitAPIURL)
	}
	if cfg.TrustProxyHeaders {
		t.Error("TrustProxyHeaders should default to false")
	}
	if label, ok := cfg.Keys.Match("0123456789abcdef"); !ok || label != "alice" {
		t.Errorf("Match = %q, %v", label, ok)
	}
}

func TestLoadExplicitAPIURL(t *testing.T) {
	values := validEnv()
	values["LIVEKIT_API_URL"] = "http://livekit:7880/"
	values["PLAINCALL_TRUST_PROXY_HEADERS"] = "true"
	values["PLAINCALL_ADDR"] = "127.0.0.1:9000"
	cfg, err := Load(env(values))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.LiveKitAPIURL != "http://livekit:7880" {
		t.Errorf("LiveKitAPIURL = %q", cfg.LiveKitAPIURL)
	}
	if !cfg.TrustProxyHeaders || cfg.Addr != "127.0.0.1:9000" {
		t.Errorf("unexpected config: %+v", cfg)
	}
}

func TestLoadReportsEveryProblem(t *testing.T) {
	_, err := Load(env(map[string]string{
		"LIVEKIT_URL":                   "https://rtc.example.com",
		"PLAINCALL_TRUST_PROXY_HEADERS": "maybe",
	}))
	if err == nil {
		t.Fatal("expected an error")
	}
	for _, want := range []string{"PLAINCALL_KEYS", "LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "PLAINCALL_TRUST_PROXY_HEADERS"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error does not mention %s: %v", want, err)
		}
	}
}

func TestConnectSources(t *testing.T) {
	cfg, err := Load(env(validEnv()))
	if err != nil {
		t.Fatal(err)
	}
	got := cfg.ConnectSources()
	if len(got) != 2 || got[0] != "wss://rtc.example.com" || got[1] != "https://rtc.example.com" {
		t.Errorf("ConnectSources = %v", got)
	}
}

func TestParseKeys(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		wantErr string
	}{
		{"valid pair", "a:0123456789abcdef", ""},
		{"valid several", "a:0123456789abcdef, b-2:fedcba9876543210", ""},
		{"empty", "", "at least one key"},
		{"missing colon", "0123456789abcdef", "label:secret"},
		{"bad label", "a b:0123456789abcdef", "label"},
		{"short secret", "a:short", "at least 16"},
		{"whitespace secret", "a:0123456789 abcdef", "whitespace"},
		{"duplicate label", "a:0123456789abcdef,a:fedcba9876543210", "used twice"},
		{"duplicate secret", "a:0123456789abcdef,b:0123456789abcdef", "same secret"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := ParseKeys(tt.raw)
			switch {
			case tt.wantErr == "" && err != nil:
				t.Fatalf("unexpected error: %v", err)
			case tt.wantErr != "" && (err == nil || !strings.Contains(err.Error(), tt.wantErr)):
				t.Fatalf("error = %v, want it to contain %q", err, tt.wantErr)
			}
		})
	}
}

func TestKeysMatch(t *testing.T) {
	keys, err := ParseKeys("alice:0123456789abcdef,bob:fedcba9876543210")
	if err != nil {
		t.Fatal(err)
	}
	if keys.Len() != 2 {
		t.Fatalf("Len = %d", keys.Len())
	}
	if label, ok := keys.Match("fedcba9876543210"); !ok || label != "bob" {
		t.Errorf("Match(bob) = %q, %v", label, ok)
	}
	if _, ok := keys.Match("nope"); ok {
		t.Error("Match accepted a wrong key")
	}
	if _, ok := keys.Match(""); ok {
		t.Error("Match accepted an empty key")
	}
}
