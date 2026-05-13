package main

import (
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHealthcheck(t *testing.T) {
	status := http.StatusOK
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/healthz" {
			t.Errorf("path = %s", r.URL.Path)
		}
		w.WriteHeader(status)
	}))
	defer server.Close()

	_, port, _ := net.SplitHostPort(strings.TrimPrefix(server.URL, "http://"))
	t.Setenv("PLAINCALL_ADDR", ":"+port)
	if code := healthcheck(); code != 0 {
		t.Errorf("healthy server: exit code %d", code)
	}

	status = http.StatusServiceUnavailable
	if code := healthcheck(); code != 1 {
		t.Errorf("unhealthy server: exit code %d", code)
	}

	server.Close()
	if code := healthcheck(); code != 1 {
		t.Errorf("server down: exit code %d", code)
	}
}

func TestHealthcheckBadAddress(t *testing.T) {
	t.Setenv("PLAINCALL_ADDR", "not an address")
	if code := healthcheck(); code != 1 {
		t.Errorf("exit code %d, want 1", code)
	}
}
