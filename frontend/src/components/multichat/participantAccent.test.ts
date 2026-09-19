import { describe, expect, it } from "vitest";
import { colorWithAlpha, participantAccent } from "./participantAccent";

describe("participantAccent", () => {
	it("gives each roster position a stable, distinct accent", () => {
		expect(participantAccent(0)).toBe("#4263eb");
		expect(participantAccent(1)).not.toBe(participantAccent(0));
		expect(participantAccent(8)).toBe(participantAccent(0));
	});

	it("converts accents into rgba tints and rejects invalid colors", () => {
		expect(colorWithAlpha("#4263eb", 0.14)).toBe("rgba(66, 99, 235, 0.14)");
		expect(colorWithAlpha("junk", 0.14)).toBe("rgba(0, 0, 0, 0)");
	});
});
