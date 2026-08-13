// Verifies Gateway build identity parsing and bilateral compatibility policy.
package buildinfo

import "testing"

func TestVerifyMutualAcceptsSharedCompatibilitySeries(t *testing.T) {
	gateway := Current()
	engine := Record{
		Component: "engine",
		Version:   "V0.1.8.42",
		Compatibility: map[string]Range{
			"gateway": {Min: "V0.1.0.0", MaxExclusive: "V0.2.0.0"},
		},
	}
	if err := VerifyMutual(gateway, engine); err != nil {
		t.Fatalf("compatible records rejected: %v", err)
	}
}

func TestVerifyMutualRejectsEitherIncompatibleDirection(t *testing.T) {
	gateway := Current()
	engine := Record{
		Component: "engine",
		Version:   "V0.2.0.0",
		Compatibility: map[string]Range{
			"gateway": {Min: "V0.1.0.0", MaxExclusive: "V0.2.0.0"},
		},
	}
	if err := VerifyMutual(gateway, engine); err == nil {
		t.Fatal("Gateway accepted an Engine outside its declared range")
	}

	engine.Version = "V0.1.0.0"
	engine.Compatibility["gateway"] = Range{Min: "V0.2.0.0", MaxExclusive: "V0.3.0.0"}
	if err := VerifyMutual(gateway, engine); err == nil {
		t.Fatal("Engine accepted a Gateway outside its declared range")
	}
}

func TestCurrentAlwaysIncludesBuildID(t *testing.T) {
	record := Current()
	if len(record.BuildID) != 12 {
		t.Fatalf("build id = %q", record.BuildID)
	}
	if PublicVersion("V0.1.25.142") != "V0.1.25" {
		t.Fatal("public version exposed the patch tier")
	}
}
