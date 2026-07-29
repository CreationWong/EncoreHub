import { describe, expect, it } from "vitest";
import packageJson from "../../../package.json";
import {
	COMPONENT_LAYERS,
	THIRD_PARTY_COMPONENTS,
} from "./thirdPartyComponents";

describe("third-party component notices", () => {
	it("discloses every declared frontend runtime dependency", () => {
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

	it("keeps component records complete and unique", () => {
		const packageNames = THIRD_PARTY_COMPONENTS.map(
			(component) => component.packageName,
		);
		expect(new Set(packageNames).size).toBe(packageNames.length);
		for (const component of THIRD_PARTY_COMPONENTS) {
			expect(COMPONENT_LAYERS).toContain(component.layer);
			expect(component.version).not.toBe("");
			expect(component.license).not.toBe("");
		}
	});
});
