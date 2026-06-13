package roomtoken

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"
	"unicode"
)

const (
	legacyPrefix         = "r"
	legacyRandomBytes    = 12
	legacySignatureBytes = 16
	shortCodeLength      = 10
	shortAlphabet        = "23456789abcdefghjkmnpqrstuvwxyz"
)

type Room struct {
	Code        string
	LiveKitRoom string
	ExpiresAt   time.Time
}

type Manager struct {
	secret []byte
	ttl    time.Duration
	now    func() time.Time
	rand   io.Reader
}

func New(secret string, ttl time.Duration) *Manager {
	return &Manager{
		secret: []byte(secret),
		ttl:    ttl,
		now:    time.Now,
		rand:   rand.Reader,
	}
}

// Create returns a short stateless room code. There is intentionally no server-side
// registry: any syntactically valid short code resolves to a deterministic LiveKit
// room. This is an alpha convenience model, not an access-control boundary.
func (m *Manager) Create() (Room, error) {
	buffer := make([]byte, shortCodeLength)
	if _, err := io.ReadFull(m.rand, buffer); err != nil {
		return Room{}, fmt.Errorf("generate room code: %w", err)
	}
	for index := range buffer {
		buffer[index] = shortAlphabet[int(buffer[index])%len(shortAlphabet)]
	}
	return m.Resolve(string(buffer))
}

func (m *Manager) Resolve(raw string) (Room, error) {
	raw = strings.TrimSpace(raw)
	if strings.HasPrefix(raw, legacyPrefix+".") {
		return m.resolveLegacy(raw)
	}

	code := normalizeShortCode(raw)
	if len(code) != shortCodeLength {
		return Room{}, fmt.Errorf("invalid room code")
	}
	for _, char := range code {
		if !strings.ContainsRune(shortAlphabet, char) {
			return Room{}, fmt.Errorf("invalid room code")
		}
	}
	return Room{Code: Format(code), LiveKitRoom: m.liveKitRoom(code)}, nil
}

func Format(raw string) string {
	code := normalizeShortCode(raw)
	if len(code) != shortCodeLength {
		return raw
	}
	return code[:3] + "-" + code[3:7] + "-" + code[7:]
}

func normalizeShortCode(raw string) string {
	var builder strings.Builder
	builder.Grow(len(raw))
	for _, char := range strings.ToLower(raw) {
		if char == '-' || unicode.IsSpace(char) {
			continue
		}
		builder.WriteRune(char)
	}
	return builder.String()
}

func (m *Manager) liveKitRoom(value string) string {
	mac := hmac.New(sha256.New, m.secret)
	_, _ = mac.Write([]byte("plaincall-room:" + value))
	return "pc_" + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)[:18])
}

func (m *Manager) resolveLegacy(room string) (Room, error) {
	parts := strings.Split(room, ".")
	if len(parts) != 4 || parts[0] != legacyPrefix {
		return Room{}, fmt.Errorf("invalid room link")
	}
	if len(parts[1]) != 16 || len(parts[2]) == 0 || len(parts[3]) == 0 {
		return Room{}, fmt.Errorf("invalid room link")
	}
	if _, err := base64.RawURLEncoding.DecodeString(parts[1]); err != nil {
		return Room{}, fmt.Errorf("invalid room link")
	}

	expiresUnix, err := strconv.ParseInt(parts[2], 36, 64)
	if err != nil {
		return Room{}, fmt.Errorf("invalid room link")
	}
	expiresAt := time.Unix(expiresUnix, 0)
	if !m.now().Before(expiresAt) {
		return Room{}, fmt.Errorf("room link expired")
	}

	expected := m.signLegacy(parts[1] + "." + parts[2])
	if !hmac.Equal([]byte(parts[3]), []byte(expected)) {
		return Room{}, fmt.Errorf("invalid room link")
	}
	return Room{Code: room, LiveKitRoom: m.liveKitRoom(room), ExpiresAt: expiresAt}, nil
}

func (m *Manager) signLegacy(value string) string {
	mac := hmac.New(sha256.New, m.secret)
	_, _ = mac.Write([]byte(value))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil)[:legacySignatureBytes])
}

// createLegacy is retained for regression tests and active Alpha 1 links.
func (m *Manager) createLegacy() (Room, error) {
	random := make([]byte, legacyRandomBytes)
	if _, err := io.ReadFull(m.rand, random); err != nil {
		return Room{}, fmt.Errorf("generate room random bytes: %w", err)
	}
	id := base64.RawURLEncoding.EncodeToString(random)
	expiresAt := m.now().UTC().Add(m.ttl)
	expires := strconv.FormatInt(expiresAt.Unix(), 36)
	code := strings.Join([]string{legacyPrefix, id, expires, m.signLegacy(id + "." + expires)}, ".")
	return Room{Code: code, LiveKitRoom: m.liveKitRoom(code), ExpiresAt: expiresAt}, nil
}
