import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordOutputSample, recordSample } from "../../services/tokenModel";
import { useToastStore } from "../../stores/toastStore";
import TokenModelsPanel from "./TokenModelsPanel";

beforeEach(() => {
	localStorage.clear();
	useToastStore.setState({ toasts: [] });
});

afterEach(cleanup);

describe("TokenModelsPanel", () => {
	it("shows an empty state before any model is calibrated", () => {
		render(<TokenModelsPanel />);

		expect(screen.getByText(/No calibrated models yet/)).toBeDefined();
	});

	it("lists fitted models with coefficients and clears them all", () => {
		recordSample(
			"openai|gpt-test",
			"msg-1",
			{ asciiBytes: 80, nonAsciiChars: 0, messageCount: 2 },
			40,
		);
		recordOutputSample(
			"openai|gpt-test",
			"msg-1",
			{ asciiBytes: 40, nonAsciiChars: 0 },
			10,
		);

		render(<TokenModelsPanel />);

		expect(screen.getByText("openai|gpt-test")).toBeDefined();
		expect(screen.getByText("Input · 1 samples")).toBeDefined();
		expect(screen.getByText("Output · 1 samples")).toBeDefined();

		fireEvent.click(screen.getByRole("button", { name: "Clear all" }));

		expect(screen.getByText(/No calibrated models yet/)).toBeDefined();
		expect(useToastStore.getState().toasts[0]?.kind).toBe("info");
	});
});
