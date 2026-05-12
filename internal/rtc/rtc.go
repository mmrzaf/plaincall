// Package rtc issues LiveKit access tokens and calls LiveKit's room service.
//
// Access tokens are JWTs signed with the LiveKit API secret. The room service
// is LiveKit's Twirp API, called with JSON over HTTP.
package rtc

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Role says what a participant may do beyond joining a call.
type Role string

const (
	// RoleGuest joins with a name and no key.
	RoleGuest Role = "guest"
	// RoleMember joins with a member key and can manage the room.
	RoleMember Role = "member"
)

// RoleAttribute is the participant attribute that carries the role. It is set
// by the signed access token, so participants cannot change it themselves.
const RoleAttribute = "role"

const (
	joinTokenTTL   = 10 * time.Minute
	adminTokenTTL  = time.Minute
	requestTimeout = 8 * time.Second
	maxResponse    = 1 << 20
)

// ErrNotFound is returned when LiveKit reports that a room or participant
// does not exist.
var ErrNotFound = errors.New("not found")

// Presence describes the state of a room at one moment.
type Presence struct {
	// Locked is true while the room refuses new guests.
	Locked bool
	// MemberPresent is true while at least one member is in the room.
	MemberPresent bool
}

// Client talks to one LiveKit server.
type Client struct {
	apiURL string
	key    string
	secret []byte
	http   *http.Client
	now    func() time.Time
}

// New returns a Client for the LiveKit server at apiURL, which is an http or
// https URL without a trailing slash.
func New(apiURL, apiKey, apiSecret string) *Client {
	return &Client{
		apiURL: apiURL,
		key:    apiKey,
		secret: []byte(apiSecret),
		http:   &http.Client{Timeout: requestTimeout},
		now:    time.Now,
	}
}

// JoinToken returns an access token that lets one participant join room.
func (c *Client) JoinToken(room, name string, role Role) (string, error) {
	identity, err := newIdentity()
	if err != nil {
		return "", err
	}
	claims := accessClaims{
		Issuer:     c.key,
		Subject:    identity,
		ExpiresAt:  jwt.NewNumericDate(c.now().Add(joinTokenTTL)),
		Name:       name,
		Attributes: map[string]string{RoleAttribute: string(role)},
		Video: videoGrant{
			Room:           room,
			RoomJoin:       true,
			CanPublish:     new(true),
			CanSubscribe:   new(true),
			CanPublishData: new(false),
			CanPublishSources: []string{
				"camera", "microphone", "screen_share", "screen_share_audio",
			},
		},
	}
	return c.sign(claims)
}

// Presence reports whether room is locked and whether a member is in it. A
// room that does not exist is empty and unlocked.
func (c *Client) Presence(ctx context.Context, room string) (Presence, error) {
	var listed struct {
		Rooms []struct {
			Metadata string `json:"metadata"`
		} `json:"rooms"`
	}
	if err := c.call(ctx, "ListRooms", room, map[string]any{"names": []string{room}}, &listed); err != nil {
		return Presence{}, err
	}
	if len(listed.Rooms) == 0 {
		return Presence{}, nil
	}
	presence := Presence{Locked: parseMetadata(listed.Rooms[0].Metadata).Locked}

	var participants struct {
		Participants []struct {
			State      string            `json:"state"`
			Attributes map[string]string `json:"attributes"`
		} `json:"participants"`
	}
	err := c.call(ctx, "ListParticipants", room, map[string]any{"room": room}, &participants)
	if errors.Is(err, ErrNotFound) {
		return presence, nil
	}
	if err != nil {
		return Presence{}, err
	}
	for _, p := range participants.Participants {
		if p.State != "DISCONNECTED" && p.Attributes[RoleAttribute] == string(RoleMember) {
			presence.MemberPresent = true
			break
		}
	}
	return presence, nil
}

// Remove disconnects one participant from room.
func (c *Client) Remove(ctx context.Context, room, identity string) error {
	return c.call(ctx, "RemoveParticipant", room, map[string]any{"room": room, "identity": identity}, nil)
}

// End closes room and disconnects everyone in it.
func (c *Client) End(ctx context.Context, room string) error {
	return c.call(ctx, "DeleteRoom", room, map[string]any{"room": room}, nil)
}

// SetLocked locks or unlocks room for new guests. The flag lives in the room's
// metadata, so it lasts as long as the room does.
func (c *Client) SetLocked(ctx context.Context, room string, locked bool) error {
	metadata, err := json.Marshal(roomMetadata{Locked: locked})
	if err != nil {
		return err
	}
	return c.call(ctx, "UpdateRoomMetadata", room, map[string]any{"room": room, "metadata": string(metadata)}, nil)
}

type roomMetadata struct {
	Locked bool `json:"locked"`
}

func parseMetadata(raw string) roomMetadata {
	var m roomMetadata
	_ = json.Unmarshal([]byte(raw), &m)
	return m
}

type accessClaims struct {
	jwt.RegisteredClaims
	Name       string            `json:"name,omitempty"`
	Attributes map[string]string `json:"attributes,omitempty"`
	Video      videoGrant        `json:"video"`
}

type videoGrant struct {
	Room              string   `json:"room,omitempty"`
	RoomJoin          bool     `json:"roomJoin,omitempty"`
	RoomAdmin         bool     `json:"roomAdmin,omitempty"`
	RoomCreate        bool     `json:"roomCreate,omitempty"`
	RoomList          bool     `json:"roomList,omitempty"`
	CanPublish        *bool    `json:"canPublish,omitempty"`
	CanSubscribe      *bool    `json:"canSubscribe,omitempty"`
	CanPublishData    *bool    `json:"canPublishData,omitempty"`
	CanPublishSources []string `json:"canPublishSources,omitempty"`
}

func (c *Client) sign(claims accessClaims) (string, error) {
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(c.secret)
	if err != nil {
		return "", fmt.Errorf("sign access token: %w", err)
	}
	return signed, nil
}

// adminToken returns a short-lived token for the room service, limited to room.
func (c *Client) adminToken(room string) (string, error) {
	return c.sign(accessClaims{
		Issuer:    c.key,
		Subject:   "plaincall",
		ExpiresAt: jwt.NewNumericDate(c.now().Add(adminTokenTTL)),
		Video:     videoGrant{Room: room, RoomAdmin: true, RoomCreate: true, RoomList: true},
	})
}

// call invokes one method of LiveKit's RoomService.
func (c *Client) call(ctx context.Context, method, room string, in, out any) error {
	token, err := c.adminToken(room)
	if err != nil {
		return err
	}
	body, err := json.Marshal(in)
	if err != nil {
		return fmt.Errorf("encode %s request: %w", method, err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.apiURL+"/twirp/livekit.RoomService/"+method, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build %s request: %w", method, err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("livekit %s: %w", method, err)
	}
	defer func() { _ = resp.Body.Close() }()
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxResponse))
	if err != nil {
		return fmt.Errorf("livekit %s: read response: %w", method, err)
	}

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		var failure struct {
			Code string `json:"code"`
			Msg  string `json:"msg"`
		}
		_ = json.Unmarshal(data, &failure)
		if failure.Code == "not_found" {
			return fmt.Errorf("livekit %s: %s: %w", method, failure.Msg, ErrNotFound)
		}
		return fmt.Errorf("livekit %s: status %d: %s %s", method, resp.StatusCode, failure.Code, failure.Msg)
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(data, out); err != nil {
		return fmt.Errorf("livekit %s: decode response: %w", method, err)
	}
	return nil
}

func newIdentity() (string, error) {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("generate participant identity: %w", err)
	}
	return "p_" + base64.RawURLEncoding.EncodeToString(buf), nil
}
