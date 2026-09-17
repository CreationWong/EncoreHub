// Occupancy meter formatting and fallback contracts.
import { describe, expect, it } from "vitest";
import {
	DEFAULT_CONTEXT_METER_METRICS,
	DEFAULT_CONTEXT_METER_PRIMARY,
} from "../../stores/settingsStore";
import {
	formatContextMeterLine,
	formatContextPercentage,
	resolveContextMeterDisplay,
	resolveContextMeterPrimary,
} from "./contextMeterDisplay";

const values = {
	used: 4,
	limit: 1000,
	percentage: 0.4,
	remaining: 996,
};

describe("contextMeterDisplay", () => {
	it("keeps sub-percent precision instead of rounding a live window to 0%", () => {
		expect(formatContextPercentage(0)).toBe("0%");
		expect(formatContextPercentage(0.004)).toBe("<0.01%");
		expect(formatContextPercentage(0.4)).toBe("0.4%");
		expect(formatContextPercentage(12.4)).toBe("12%");
	});

	it("defaults to window percentage with remaining tokens underneath", () => {
		// Hidden absolute counts stay out of the default glance path so the
		// meter matches the conversation panel before any Settings edits.
		const display = resolveContextMeterDisplay(
			values,
			DEFAULT_CONTEXT_METER_PRIMARY,
			DEFAULT_CONTEXT_METER_METRICS,
		);

		expect(display.primary).toMatchObject({ id: "percentage", text: "0.4%" });
		expect(display.secondary.map((line) => line.text)).toEqual([
			"996 tokens remaining",
		]);
	});

	it("promotes remaining tokens without duplicating them as a secondary line", () => {
		const display = resolveContextMeterDisplay(values, "remaining", [
			{ id: "percentage", visible: true },
			{ id: "remaining", visible: true },
			{ id: "usedOfLimit", visible: true },
			{ id: "used", visible: false },
		]);

		expect(display.primary.text).toBe("996 remaining");
		expect(display.secondary.map((line) => line.text)).toEqual([
			"0.4% of window",
			"4 of 1,000 tokens",
		]);
	});

	it("falls back to used tokens when the window is unknown", () => {
		const unknown = {
			used: 4,
			limit: null,
			percentage: null,
			remaining: null,
		};

		expect(
			resolveContextMeterPrimary(
				unknown,
				"percentage",
				DEFAULT_CONTEXT_METER_METRICS,
			),
		).toBe("used");
		expect(formatContextMeterLine("percentage", unknown, "primary")).toBeNull();
		expect(
			resolveContextMeterDisplay(
				unknown,
				"percentage",
				DEFAULT_CONTEXT_METER_METRICS,
			),
		).toEqual({
			primary: { id: "used", text: "4" },
			secondary: [],
		});
	});
});
