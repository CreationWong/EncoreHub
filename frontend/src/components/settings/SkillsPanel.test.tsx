import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const list = vi.fn();
const toggle = vi.fn();
vi.mock("../../services/skills", () => ({
	skillsApi: {
		list: () => list(),
		toggle: (id: string, enabled: boolean) => toggle(id, enabled),
	},
}));

import { useToastStore } from "../../stores/toastStore";
import SkillsPanel from "./SkillsPanel";

const skillFixture = {
	id: "skill-1",
	name: "Code Explainer",
	description: "Explains code on demand",
	version: "0.1.0",
	author: "EncoreHub",
	enabled: true,
	builtin: true,
	triggers: ["explain", "review"],
	tool_count: 2,
};

beforeEach(() => {
	list.mockReset().mockResolvedValue({ skills: [skillFixture] });
	toggle.mockReset().mockResolvedValue(undefined);
	useToastStore.setState({ toasts: [] });
});

afterEach(cleanup);

describe("SkillsPanel", () => {
	it("renders skill name + builtin badge + tool count", async () => {
		render(<SkillsPanel />);
		await waitFor(() => expect(list).toHaveBeenCalled());
		await waitFor(() => {
			expect(screen.getByText("Code Explainer")).toBeDefined();
			expect(screen.getByText("builtin")).toBeDefined();
			expect(screen.getByText(/2 tools/)).toBeDefined();
			expect(screen.getByText("explain")).toBeDefined();
		});
	});

	it("toggle switch flips state optimistically and calls the API", async () => {
		render(<SkillsPanel />);
		await waitFor(() => expect(list).toHaveBeenCalled());

		// switch button is the only role=switch on the page
		const sw = await screen.findByRole("switch");
		expect(sw.getAttribute("aria-checked")).toBe("true");
		fireEvent.click(sw);

		await waitFor(() => expect(toggle).toHaveBeenCalledWith("skill-1", false));
		await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe("false"));
	});

	it("rolls back the switch and surfaces an error on API failure", async () => {
		toggle.mockReset().mockRejectedValue(new Error("nope"));
		render(<SkillsPanel />);
		await waitFor(() => expect(list).toHaveBeenCalled());
		const sw = await screen.findByRole("switch");
		fireEvent.click(sw);
		await waitFor(() => expect(toggle).toHaveBeenCalled());
		await waitFor(() => {
			// rolled back to original (true) and error surfaced via toast
			expect(sw.getAttribute("aria-checked")).toBe("true");
			expect(
				useToastStore.getState().toasts.some((t) => t.message === "nope"),
			).toBe(true);
		});
	});

	it("shows the empty state when no skills are installed", async () => {
		list.mockReset().mockResolvedValue({ skills: [] });
		render(<SkillsPanel />);
		await waitFor(() => expect(list).toHaveBeenCalled());
		await waitFor(() =>
			expect(screen.getByText(/No skills installed/)).toBeDefined(),
		);
	});
});
