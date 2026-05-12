package server

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	minRoomLength = 3
	maxRoomLength = 48
	maxNameLength = 40
)

// normalizeRoom lower-cases a room name and reports whether it is valid: 3 to
// 48 characters, lowercase letters and digits, with single hyphens between.
func normalizeRoom(raw string) (string, bool) {
	room := strings.ToLower(strings.TrimSpace(raw))
	if len(room) < minRoomLength || len(room) > maxRoomLength {
		return "", false
	}
	previousHyphen := true // a name cannot start with a hyphen
	for i := 0; i < len(room); i++ {
		switch c := room[i]; {
		case c >= 'a' && c <= 'z', c >= '0' && c <= '9':
			previousHyphen = false
		case c == '-' && !previousHyphen:
			previousHyphen = true
		default:
			return "", false
		}
	}
	if previousHyphen { // a name cannot end with a hyphen
		return "", false
	}
	return room, true
}

// cleanName tidies a display name and reports whether it is acceptable.
func cleanName(raw string) (string, bool) {
	name := strings.Join(strings.Fields(raw), " ")
	if name == "" || !utf8.ValidString(name) || utf8.RuneCountInString(name) > maxNameLength {
		return "", false
	}
	for _, r := range name {
		if unicode.IsControl(r) || isBidiControl(r) {
			return "", false
		}
	}
	return name, true
}

// isBidiControl reports whether r changes text direction, which could be used
// to make one name look like another.
func isBidiControl(r rune) bool {
	return (r >= 0x202A && r <= 0x202E) || (r >= 0x2066 && r <= 0x2069)
}
