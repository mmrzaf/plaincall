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
)

const (
	prefix         = "r"
	randomBytes    = 12
	signatureBytes = 16
)

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

func (m *Manager) Create() (string, time.Time, error) {
	random := make([]byte, randomBytes)
	if _, err := io.ReadFull(m.rand, random); err != nil {
		return "", time.Time{}, fmt.Errorf("generate room random bytes: %w", err)
	}

	id := base64.RawURLEncoding.EncodeToString(random)
	expiresAt := m.now().UTC().Add(m.ttl)
	expires := strconv.FormatInt(expiresAt.Unix(), 36)
	signature := m.sign(id + "." + expires)
	return strings.Join([]string{prefix, id, expires, signature}, "."), expiresAt, nil
}

func (m *Manager) Verify(room string) error {
	parts := strings.Split(room, ".")
	if len(parts) != 4 || parts[0] != prefix {
		return fmt.Errorf("invalid room link")
	}
	if len(parts[1]) != 16 || len(parts[2]) == 0 || len(parts[3]) == 0 {
		return fmt.Errorf("invalid room link")
	}
	if _, err := base64.RawURLEncoding.DecodeString(parts[1]); err != nil {
		return fmt.Errorf("invalid room link")
	}

	expiresUnix, err := strconv.ParseInt(parts[2], 36, 64)
	if err != nil {
		return fmt.Errorf("invalid room link")
	}
	expiresAt := time.Unix(expiresUnix, 0)
	if !m.now().Before(expiresAt) {
		return fmt.Errorf("room link expired")
	}

	expected := m.sign(parts[1] + "." + parts[2])
	if !hmac.Equal([]byte(parts[3]), []byte(expected)) {
		return fmt.Errorf("invalid room link")
	}
	return nil
}

func (m *Manager) sign(value string) string {
	mac := hmac.New(sha256.New, m.secret)
	_, _ = mac.Write([]byte(value))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil)[:signatureBytes])
}
