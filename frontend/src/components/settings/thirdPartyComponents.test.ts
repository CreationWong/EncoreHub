/** Verifies the generated target-specific OSS manifest consumed by the UI. */
import { describe, expect, it } from "vitest";
import packageJson from "../../../package.json";
import {
	COMPONENT_LAYERS,
	OSS_RELEASE_TARGET,
	THIRD_PARTY_COMPONENTS,
} from "./thirdPartyComponents";

describe("third-party component notices", () => {
	it("includes every declared frontend runtime dependency", () => {
		const disclosed = new Set(
			THIRD_PARTY_COMPONENTS.map((component) => component.packageName),
		);

		for (const packageName of Object.keys(packageJson.dependencies)) {
			expect(
				disclosed.has(packageName),
				`${packageName} is not disclosed`,
			).toBe(true);
		}
	});

	it("keeps exact target component records complete and unique", () => {
		const packageIds = THIRD_PARTY_COMPONENTS.map(
			(component) =>
				`${component.ecosystem}:${component.packageName}@${component.version}`,
		);
		expect(new Set(packageIds).size).toBe(packageIds.length);
		expect(OSS_RELEASE_TARGET).not.toBe("");
		expect(THIRD_PARTY_COMPONENTS.length).toBeGreaterThan(
			Object.keys(packageJson.dependencies).length,
		);
		for (const component of THIRD_PARTY_COMPONENTS) {
			expect(COMPONENT_LAYERS).toContain(component.layer);
			expect(["npm", "cargo", "go"]).toContain(component.ecosystem);
			expect(component.packageName).not.toBe("");
			expect(component.version).not.toBe("");
			expect(component.license).not.toBe("");
		}
	});
});
