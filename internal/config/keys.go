package config

import (
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"fmt"
	"strings"
)

const (
	minKeyLength   = 16
	maxLabelLength = 32
)

// Keys is the set of member keys. Anyone who presents one of the keys is a
// member; the label identifies whose key it is in logs.
type Keys struct {
	entries []keyEntry
}

type keyEntry struct {
	label  string
	digest [sha256.Size]byte
}

// ParseKeys parses a comma-separated list of label:secret pairs, for example
// "alice:3f9c...,bob:a1b2...".
func ParseKeys(raw string) (Keys, error) {
	var keys Keys
	labels := make(map[string]bool)
	digests := make(map[[sha256.Size]byte]bool)

	for item := range strings.SplitSeq(raw, ",") {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		label, secret, ok := strings.Cut(item, ":")
		if !ok {
			return Keys{}, fmt.Errorf("entry %q must look like label:secret", truncate(item))
		}
		if !validLabel(label) {
			return Keys{}, fmt.Errorf("key label %q must be 1-%d characters of letters, digits, '.', '_' or '-'", truncate(label), maxLabelLength)
		}
		if len(secret) < minKeyLength {
			return Keys{}, fmt.Errorf("key %q must be at least %d characters", label, minKeyLength)
		}
		if strings.ContainsAny(secret, " \t\r\n") {
			return Keys{}, fmt.Errorf("key %q must not contain whitespace", label)
		}
		if labels[label] {
			return Keys{}, fmt.Errorf("key label %q is used twice", label)
		}
		digest := sha256.Sum256([]byte(secret))
		if digests[digest] {
			return Keys{}, fmt.Errorf("key %q has the same secret as another key", label)
		}
		labels[label] = true
		digests[digest] = true
		keys.entries = append(keys.entries, keyEntry{label: label, digest: digest})
	}

	if len(keys.entries) == 0 {
		return Keys{}, errors.New("at least one key is required")
	}
	return keys, nil
}

// Match reports which key, if any, the candidate secret belongs to. Every key
// is compared so the time taken does not depend on which one matched.
func (k Keys) Match(candidate string) (label string, ok bool) {
	sum := sha256.Sum256([]byte(candidate))
	for _, entry := range k.entries {
		if subtle.ConstantTimeCompare(sum[:], entry.digest[:]) == 1 {
			label, ok = entry.label, true
		}
	}
	return label, ok
}

// Len returns the number of configured keys.
func (k Keys) Len() int { return len(k.entries) }

func validLabel(label string) bool {
	if label == "" || len(label) > maxLabelLength {
		return false
	}
	for _, r := range label {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '.', r == '_', r == '-':
		default:
			return false
		}
	}
	return true
}

func truncate(s string) string {
	if len(s) > 12 {
		return s[:12] + "…"
	}
	return s
}
