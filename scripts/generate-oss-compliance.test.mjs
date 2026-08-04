/** Verifies deterministic target and license normalization for OSS manifests. */
import assert from "node:assert/strict";
import test from "node:test";
import {
	detectLicenseIdentifiers,
	normalizeComponents,
	normalizeLicense,
	rustTargetToGo,
	serializeManifest,
} from "./generate-oss-compliance.mjs";

test("maps supported desktop target triples to Gateway build targets", () => {
	assert.deepEqual(rustTargetToGo("x86_64-pc-windows-msvc"), {
		goos: "windows",
		goarch: "amd64",
	});
	assert.deepEqual(rustTargetToGo("aarch64-apple-darwin"), {
		goos: "darwin",
		goarch: "arm64",
	});
	assert.deepEqual(rustTargetToGo("x86_64-unknown-linux-gnu"), {
		goos: "linux",
		goarch: "amd64",
	});
});

test("recognizes common license metadata and texts", () => {
	assert.equal(normalizeLicense("(MIT OR Apache-2.0)"), "MIT OR Apache-2.0");
	assert.equal(normalizeLicense("MIT/Apache-2.0"), "MIT OR Apache-2.0");
	assert.equal(normalizeLicense({ type: "BSD-3-Clause" }), "BSD-3-Clause");
	assert.deepEqual(
		detectLicenseIdentifiers(
			"MIT License\nPermission is hereby granted, free of charge, to any person obtaining a copy",
		),
		["MIT"],
	);
	assert.deepEqual(
		detectLicenseIdentifiers(
			"Apache License\nVersion 2.0\nRedistribution and use in source and binary forms, with or without modification, are permitted. Neither the name may be used.",
		),
		["Apache-2.0", "BSD-3-Clause"],
	);
});

test("deduplicates exact packages while retaining multiple locked versions", () => {
	const base = {
		ecosystem: "cargo",
		layer: "Engine",
		name: "example",
		packageName: "example",
		license: "MIT",
	};
	const result = normalizeComponents([
		{ ...base, version: "2.0.0" },
		{ ...base, version: "1.0.0" },
		{ ...base, version: "1.0.0" },
	]);
	assert.deepEqual(
		result.map((component) => component.version),
		["1.0.0", "2.0.0"],
	);
});

test("serializes generated manifests using the repository formatter style", () => {
	assert.equal(
		serializeManifest({ schemaVersion: 1, components: [] }),
		'{\n\t"schemaVersion": 1,\n\t"components": []\n}\n',
	);
});
