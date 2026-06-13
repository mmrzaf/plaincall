package livekittoken

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"time"
)

type Issuer struct {
	apiKey    string
	apiSecret []byte
	ttl       time.Duration
	now       func() time.Time
	rand      io.Reader
}

type claims struct {
	Issuer    string     `json:"iss"`
	Subject   string     `json:"sub"`
	Name      string     `json:"name,omitempty"`
	NotBefore int64      `json:"nbf"`
	ExpiresAt int64      `json:"exp"`
	JWTID     string     `json:"jti"`
	Video     videoGrant `json:"video"`
}

type videoGrant struct {
	RoomJoin       bool     `json:"roomJoin"`
	Room           string   `json:"room"`
	CanPublish     bool     `json:"canPublish"`
	CanSubscribe   bool     `json:"canSubscribe"`
	CanPublishData bool     `json:"canPublishData"`
	PublishSources []string `json:"canPublishSources"`
}

func New(apiKey, apiSecret string, ttl time.Duration) *Issuer {
	return &Issuer{apiKey: apiKey, apiSecret: []byte(apiSecret), ttl: ttl, now: time.Now, rand: rand.Reader}
}

func (i *Issuer) Issue(room, displayName string, invitationExpiresAt time.Time) (token string, identity string, err error) {
	identity, err = randomID(i.rand, "p_", 12)
	if err != nil {
		return "", "", fmt.Errorf("generate participant identity: %w", err)
	}
	jwtID, err := randomID(i.rand, "", 12)
	if err != nil {
		return "", "", fmt.Errorf("generate token id: %w", err)
	}

	now := i.now().UTC()
	expiresAt := now.Add(i.ttl)
	if !invitationExpiresAt.IsZero() && invitationExpiresAt.Before(expiresAt) {
		expiresAt = invitationExpiresAt
	}
	if !now.Before(expiresAt) {
		return "", "", fmt.Errorf("invitation expired")
	}
	payload := claims{
		Issuer: i.apiKey, Subject: identity, Name: displayName,
		NotBefore: now.Add(-5 * time.Second).Unix(), ExpiresAt: expiresAt.Unix(), JWTID: jwtID,
		Video: videoGrant{RoomJoin: true, Room: room, CanPublish: true, CanSubscribe: true, CanPublishData: false,
			PublishSources: []string{"camera", "microphone", "screen_share", "screen_share_audio"}},
	}

	header := map[string]string{"alg": "HS256", "typ": "JWT"}
	encodedHeader, err := encodeJSON(header)
	if err != nil {
		return "", "", err
	}
	encodedPayload, err := encodeJSON(payload)
	if err != nil {
		return "", "", err
	}
	unsigned := encodedHeader + "." + encodedPayload
	mac := hmac.New(sha256.New, i.apiSecret)
	_, _ = mac.Write([]byte(unsigned))
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), identity, nil
}

func randomID(reader io.Reader, prefix string, size int) (string, error) {
	buffer := make([]byte, size)
	if _, err := io.ReadFull(reader, buffer); err != nil {
		return "", err
	}
	return prefix + base64.RawURLEncoding.EncodeToString(buffer), nil
}

func encodeJSON(value any) (string, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return "", fmt.Errorf("encode jwt: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(encoded), nil
}
