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

// Quality is a room's media preset. A host picks it when starting the room,
// and every browser in the room applies it to its camera and screen share.
type Quality string

const (
	// QualityPresentation favours sharp slides: full-size screen shares at a low
	// frame rate.
	QualityPresentation Quality = "presentation"
	// QualityMeeting favours smooth motion, for demos and video.
	QualityMeeting Quality = "meeting"
	// QualityLow saves bandwidth with smaller video and a lower frame rate.
	QualityLow Quality = "low"
)

// DefaultQuality is used when a room has no preset.
const DefaultQuality = QualityPresentation

// ParseQuality reports whether raw names a preset. An empty string means the
// default.
func ParseQuality(raw string) (Quality, bool) {
	switch q := Quality(raw); q {
	case "":
		return DefaultQuality, true
	case QualityPresentation, QualityMeeting, QualityLow:
		return q, true
	}
	return "", false
}

// Room describes a room as LiveKit reports it.
type Room struct {
	// Locked is true while the room refuses new guests.
	Locked bool
	// Quality is the room's preset, or empty when it has none.
	Quality Quality
	// Participants is the number of people connected.
	Participants int
}

// Presence describes the state of a room at one moment.
type Presence struct {
	Room
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
			// Data messages carry chat. LiveKit tells receivers who sent each one,
			// so a sender cannot pose as someone else.
			CanPublishData: new(true),
			CanPublishSources: []string{
				"camera", "microphone", "screen_share", "screen_share_audio",
			},
		},
	}
	return c.sign(claims)
}

// Presence reports the state of room and whether a member is in it. A room that
// does not exist is empty and unlocked.
func (c *Client) Presence(ctx context.Context, room string) (Presence, error) {
	info, found, err := c.lookup(ctx, room)
	if err != nil || !found {
		return Presence{}, err
	}
	presence := Presence{Room: info}

	people, err := c.participants(ctx, room)
	if errors.Is(err, ErrNotFound) {
		return presence, nil
	}
	if err != nil {
		return Presence{}, err
	}
	presence.Participants = countConnected(people)
	for _, p := range people {
		if p.State != "DISCONNECTED" && p.Attributes[RoleAttribute] == string(RoleMember) {
			presence.MemberPresent = true
			break
		}
	}
	return presence, nil
}

// OpenRoom creates room with the given preset and participant limit, or returns
// the room as it already is. When two hosts start a room at the same moment,
// the first one's preset wins.
func (c *Client) OpenRoom(ctx context.Context, room string, quality Quality, maxParticipants int) (Room, error) {
	metadata, err := json.Marshal(roomMetadata{Quality: quality})
	if err != nil {
		return Room{}, err
	}
	var created liveRoom
	err = c.call(ctx, "CreateRoom", room, map[string]any{
		"name":            room,
		"metadata":        string(metadata),
		"maxParticipants": maxParticipants,
	}, &created)
	if err != nil {
		return Room{}, err
	}
	info := created.info()
	people, err := c.participants(ctx, room)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return Room{}, err
	}
	info.Participants = countConnected(people)
	return info, nil
}

// countConnected counts the people who hold a place in a room.
func countConnected(people []participant) int {
	n := 0
	for _, p := range people {
		if p.State != "DISCONNECTED" {
			n++
		}
	}
	return n
}

// lookup finds room in LiveKit's room list.
func (c *Client) lookup(ctx context.Context, room string) (Room, bool, error) {
	var listed struct {
		Rooms []liveRoom `json:"rooms"`
	}
	if err := c.call(ctx, "ListRooms", room, map[string]any{"names": []string{room}}, &listed); err != nil {
		return Room{}, false, err
	}
	if len(listed.Rooms) == 0 {
		return Room{}, false, nil
	}
	return listed.Rooms[0].info(), true, nil
}

// liveRoom is the part of LiveKit's room description that PlainCall reads.
type liveRoom struct {
	Metadata string `json:"metadata"`
}

// info reads the room's flags. LiveKit does not report who is in the room here,
// so Participants is left for the caller to fill in.
func (r liveRoom) info() Room {
	m := parseMetadata(r.Metadata)
	return Room{Locked: m.Locked, Quality: m.Quality}
}

// Remove disconnects one participant from room.
func (c *Client) Remove(ctx context.Context, room, identity string) error {
	return c.call(ctx, "RemoveParticipant", room, map[string]any{"room": room, "identity": identity}, nil)
}

// MuteMicrophone mutes one participant's microphone. It does nothing if they
// have none or it is already muted. The person can unmute themselves.
func (c *Client) MuteMicrophone(ctx context.Context, room, identity string) error {
	people, err := c.participants(ctx, room)
	if err != nil {
		return err
	}
	for _, p := range people {
		if p.Identity == identity {
			return c.muteMicrophone(ctx, room, p)
		}
	}
	return fmt.Errorf("livekit MutePublishedTrack: participant does not exist: %w", ErrNotFound)
}

// MuteGuests mutes the microphone of everyone in room except members, and
// returns how many were muted.
func (c *Client) MuteGuests(ctx context.Context, room string) (int, error) {
	people, err := c.participants(ctx, room)
	if err != nil {
		return 0, err
	}
	muted := 0
	for _, p := range people {
		if p.Attributes[RoleAttribute] == string(RoleMember) || p.State == "DISCONNECTED" || p.microphone() == nil {
			continue
		}
		if err := c.muteMicrophone(ctx, room, p); err != nil {
			return muted, err
		}
		muted++
	}
	return muted, nil
}

func (c *Client) muteMicrophone(ctx context.Context, room string, p participant) error {
	mic := p.microphone()
	if mic == nil {
		return nil
	}
	return c.call(ctx, "MutePublishedTrack", room, map[string]any{
		"room": room, "identity": p.Identity, "trackSid": mic.SID, "muted": true,
	}, nil)
}

type participant struct {
	Identity   string            `json:"identity"`
	State      string            `json:"state"`
	Attributes map[string]string `json:"attributes"`
	Tracks     []track           `json:"tracks"`
}

type track struct {
	SID    string `json:"sid"`
	Source string `json:"source"`
	Muted  bool   `json:"muted"`
}

// microphone returns the participant's microphone track if it is publishing
// and not already muted.
func (p participant) microphone() *track {
	for i := range p.Tracks {
		if p.Tracks[i].Source == "MICROPHONE" && !p.Tracks[i].Muted {
			return &p.Tracks[i]
		}
	}
	return nil
}

func (c *Client) participants(ctx context.Context, room string) ([]participant, error) {
	var listed struct {
		Participants []participant `json:"participants"`
	}
	if err := c.call(ctx, "ListParticipants", room, map[string]any{"room": room}, &listed); err != nil {
		return nil, err
	}
	return listed.Participants, nil
}

// End closes room and disconnects everyone in it.
func (c *Client) End(ctx context.Context, room string) error {
	return c.call(ctx, "DeleteRoom", room, map[string]any{"room": room}, nil)
}

// SetLocked locks or unlocks room for new guests. The flag lives in the room's
// metadata next to the preset, so it lasts as long as the room does.
func (c *Client) SetLocked(ctx context.Context, room string, locked bool) error {
	info, found, err := c.lookup(ctx, room)
	if err != nil {
		return err
	}
	if !found {
		return fmt.Errorf("livekit UpdateRoomMetadata: room does not exist: %w", ErrNotFound)
	}
	metadata, err := json.Marshal(roomMetadata{Locked: locked, Quality: info.Quality})
	if err != nil {
		return err
	}
	return c.call(ctx, "UpdateRoomMetadata", room, map[string]any{"room": room, "metadata": string(metadata)}, nil)
}

// roomMetadata is what PlainCall keeps in a room's metadata. Browsers read it
// too: the app looks at "locked" and "quality".
type roomMetadata struct {
	Locked  bool    `json:"locked"`
	Quality Quality `json:"quality,omitempty"`
}

// parseMetadata reads a room's metadata. Anything unreadable or unknown counts
// as absent.
func parseMetadata(raw string) roomMetadata {
	var m roomMetadata
	_ = json.Unmarshal([]byte(raw), &m)
	if _, ok := ParseQuality(string(m.Quality)); !ok {
		m.Quality = ""
	}
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
