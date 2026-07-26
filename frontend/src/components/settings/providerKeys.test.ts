import { describe, expect, it } from "vitest";
import {
	parseProviderAPIKeys,
	providerAPIKeySignature,
	serializeProviderAPIKeys,
} from "./providerKeys";

describe("provider API key pool", () => {
	it("treats a legacy secret as one enabled primary key", () => {
		expect(parseProviderAPIKeys(" legacy-key ")).toEqual([
			{
				id: "primary",
				name: "Primary",
				value: "legacy-key",
				enabled: true,
			},
		]);
	});

	it("round-trips enabled and disabled keys in a versioned envelope", () => {
		const keys = [
			{ id: "primary", name: "Primary", value: "key-a", enabled: true },
			{ id: "backup", name: "Backup", value: "key-b", enabled: false },
		];
		const encoded = serializeProviderAPIKeys(keys);
		expect(JSON.parse(encoded)).toEqual({ version: 1, keys });
		expect(providerAPIKeySignature(parseProviderAPIKeys(encoded))).toBe(
			providerAPIKeySignature(keys),
		);
	});
});
