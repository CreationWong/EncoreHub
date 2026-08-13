// Package buildinfo owns Gateway version identity and peer compatibility checks.
package buildinfo

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Range is a half-open peer version interval: Min <= version < MaxExclusive.
type Range struct {
	Min          string `json:"min"`
	MaxExclusive string `json:"max_exclusive"`
}

// Record is the version and peer compatibility declaration embedded in a component.
type Record struct {
	Component     string           `json:"component"`
	Version       string           `json:"version"`
	BuildID       string           `json:"build_id,omitempty"`
	Compatibility map[string]Range `json:"compatibility"`
}

// BuildID is replaced by release build scripts. Direct developer builds get a
// process-start identity so diagnostic output always includes a twelve-digit id.
var BuildID = ""

//go:embed version.json
var declaration []byte

var local = mustRecord(declaration)

// Current returns a copy of the Gateway's embedded identity.
func Current() Record {
	record := local
	record.BuildID = normalizedBuildID(BuildID, time.Now().UTC())
	return record
}

// VerifyMutual requires each component to accept the other's exact four-part version.
func VerifyMutual(left, right Record) error {
	leftRange, ok := left.Compatibility[right.Component]
	if !ok {
		return fmt.Errorf("%s does not declare compatibility with %s", left.Component, right.Component)
	}
	if !InRange(right.Version, leftRange) {
		return fmt.Errorf("%s %s does not accept %s %s", left.Component, left.Version, right.Component, right.Version)
	}
	rightRange, ok := right.Compatibility[left.Component]
	if !ok {
		return fmt.Errorf("%s does not declare compatibility with %s", right.Component, left.Component)
	}
	if !InRange(left.Version, rightRange) {
		return fmt.Errorf("%s %s does not accept %s %s", right.Component, right.Version, left.Component, left.Version)
	}
	return nil
}

// InRange reports whether version belongs to a half-open compatibility interval.
func InRange(version string, compatibility Range) bool {
	value, err := parseVersion(version)
	if err != nil {
		return false
	}
	minimum, err := parseVersion(compatibility.Min)
	if err != nil {
		return false
	}
	maximum, err := parseVersion(compatibility.MaxExclusive)
	if err != nil {
		return false
	}
	return compare(value, minimum) >= 0 && compare(value, maximum) < 0
}

// PublicVersion omits the patch/commit tier from ordinary release UI.
func PublicVersion(version string) string {
	parsed, err := parseVersion(version)
	if err != nil {
		return version
	}
	return fmt.Sprintf("V%d.%d.%d", parsed[0], parsed[1], parsed[2])
}

func mustRecord(body []byte) Record {
	var record Record
	if err := json.Unmarshal(body, &record); err != nil {
		panic(fmt.Sprintf("invalid embedded Gateway version declaration: %v", err))
	}
	if record.Component != "gateway" {
		panic("embedded Gateway version declaration has the wrong component")
	}
	if _, err := parseVersion(record.Version); err != nil {
		panic(err)
	}
	return record
}

func normalizedBuildID(value string, now time.Time) string {
	if len(value) == 12 {
		if _, err := strconv.ParseUint(value, 10, 64); err == nil {
			return value
		}
	}
	epoch := strconv.FormatInt(now.Unix(), 10)
	if len(epoch) < 6 {
		epoch = strings.Repeat("0", 6-len(epoch)) + epoch
	}
	return now.Format("060102") + epoch[len(epoch)-6:]
}

func parseVersion(value string) ([4]uint64, error) {
	var parsed [4]uint64
	parts := strings.Split(strings.TrimPrefix(strings.TrimSpace(value), "V"), ".")
	if len(parts) != len(parsed) || !strings.HasPrefix(strings.TrimSpace(value), "V") {
		return parsed, fmt.Errorf("invalid four-part version %q", value)
	}
	for index, part := range parts {
		number, err := strconv.ParseUint(part, 10, 64)
		if err != nil {
			return parsed, fmt.Errorf("invalid four-part version %q", value)
		}
		parsed[index] = number
	}
	return parsed, nil
}

func compare(left, right [4]uint64) int {
	for index := range left {
		if left[index] < right[index] {
			return -1
		}
		if left[index] > right[index] {
			return 1
		}
	}
	return 0
}
