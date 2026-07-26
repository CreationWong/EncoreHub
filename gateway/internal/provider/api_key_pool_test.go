package provider

import (
	"reflect"
	"testing"
)

func TestParseAPIKeyPoolKeepsStableIDsAndDisabledEntries(t *testing.T) {
	raw := `{"version":1,"keys":[{"id":"primary","name":"Primary","value":"key-a","enabled":true},{"id":"backup","name":"Backup","value":"key-b","enabled":false}]}`

	entries, err := ParseAPIKeyPool(raw)
	if err != nil {
		t.Fatalf("ParseAPIKeyPool() error = %v", err)
	}
	if len(entries) != 2 || entries[0].ID != "primary" || entries[1].ID != "backup" {
		t.Fatalf("entries = %#v", entries)
	}
	keys, err := ParseAPIKeys(raw)
	if err != nil {
		t.Fatalf("ParseAPIKeys() error = %v", err)
	}
	if want := []string{"key-a"}; !reflect.DeepEqual(keys, want) {
		t.Fatalf("keys = %v, want %v", keys, want)
	}
}

func TestParseAPIKeyPoolWrapsLegacySingleKey(t *testing.T) {
	entries, err := ParseAPIKeyPool("legacy-key")
	if err != nil {
		t.Fatalf("ParseAPIKeyPool() error = %v", err)
	}
	if len(entries) != 1 || entries[0].ID != "primary" || entries[0].Value != "legacy-key" || !entries[0].Enabled {
		t.Fatalf("entries = %#v", entries)
	}
}
