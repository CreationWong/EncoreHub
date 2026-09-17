// Context panel display settings: preview, primary metric, and reorder.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_CONTEXT_METER_METRICS,
	DEFAULT_CONTEXT_METER_PRIMARY,
	useSettingsStore,
} from "../../stores/settingsStore";
import ContextPanelSettings from "./ContextPanelSettings";

const elementFromPoint = vi.fn<(x: number, y: number) => Element | null>();

describe("ContextPanelSettings", () => {
	beforeEach(() => {
		localStorage.clear();
		elementFromPoint.mockReset();
		Object.defineProperty(document, "elementFromPoint", {
			configurable: true,
			value: elementFromPoint,
		});
		useSettingsStore.getState().resetContextMeterDisplay();
	});

	afterEach(cleanup);

	it("previews window percentage as the default main figure", () => {
		// The sample request is 4% of a 100k window so the default headline is
		// unambiguous and remaining tokens stay on the supporting line.
		render(<ContextPanelSettings />);

		expect(screen.getByLabelText("Context meter preview")).toBeDefined();
		expect(screen.getByText("4%")).toBeDefined();
		expect(screen.getByText("96,000 tokens remaining")).toBeDefined();
		expect(
			screen.getByRole("radio", {
				name: "Use Window used as the main context metric",
			}),
		).toHaveProperty("checked", true);
	});

	it("promotes remaining tokens in the live preview", () => {
		render(<ContextPanelSettings />);

		fireEvent.click(
			screen.getByRole("radio", {
				name: "Use Tokens remaining as the main context metric",
			}),
		);

		expect(useSettingsStore.getState().contextMeterPrimary).toBe("remaining");
		expect(screen.getByText("96,000 remaining")).toBeDefined();
		expect(screen.getByText("4% of window")).toBeDefined();
	});

	it("reorders metrics with pointer dragging from the handle", () => {
		render(<ContextPanelSettings />);
		const target = screen.getByRole("listitem", { name: "Window used" });
		elementFromPoint.mockReturnValue(target);

		fireEvent.pointerDown(
			screen.getByRole("button", { name: "Drag Tokens remaining" }),
			{ pointerId: 1 },
		);
		fireEvent.pointerMove(window, { clientX: 20, clientY: 20, pointerId: 1 });
		fireEvent.pointerUp(window, { pointerId: 1 });

		expect(
			useSettingsStore.getState().contextMeterMetrics.map((item) => item.id),
		).toEqual(["remaining", "percentage", "usedOfLimit", "used"]);
	});

	it("restores the default primary metric and order", () => {
		useSettingsStore.getState().setContextMeterPrimary("used");
		useSettingsStore.getState().moveContextMeterMetric("used", "percentage");

		render(<ContextPanelSettings />);
		fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));

		expect(useSettingsStore.getState()).toMatchObject({
			contextMeterPrimary: DEFAULT_CONTEXT_METER_PRIMARY,
			contextMeterMetrics: DEFAULT_CONTEXT_METER_METRICS.map((item) => ({
				...item,
			})),
		});
	});
});
