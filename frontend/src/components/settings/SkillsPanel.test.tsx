import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const list = vi.fn();
const toggle = vi.fn();
vi.mock("../../services/skills", () => ({
	skillsApi: {
		list: () => list(),
		toggle: (id: string, enabled: boolean) => toggle(id, enabled),
	},
}));

import SkillsPanel from "./SkillsPanel";

const skillFixture = {
	id: "skill-1",
	name: "Web Search",
	description: "Searches DuckDuckGo on demand",
	version: "0.1.0",
	author: "EncoreHub",
	enabled: true,
	builtin: true,
	triggers: ["search", "find"],
	tool_count: 2,
};

beforeEach(() => {
	list.mockReset().mockResolvedValue({ skills: [skillFixture] });
	toggle.mockReset().mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("SkillsPanel", () => {
	it("renders skill name + builtin badge + tool count", async () => {
		render(<SkillsPanel />);
		await waitFor(() => expect(list).toHaveBeenCalled());
		await waitFor(() => {
			expect(screen.getByText("Web Search")).toBeDefined();
			expect(screen.getByText("builtin")).toBeDefined();
			expect(screen.getByText(/2 tools/)).toBeDefined();
			expect(screen.getByText("search")).toBeDefined();
		});
	});

	it("toggle switch flips state optimistically and calls the API", async () => {
		render(<SkillsPanel />);
		await waitFor(() => expect(list).toHaveBeenCalled());

		// switch button is the only role=switch on the page
		const sw = await screen.findByRole("switch");
		expect(sw.getAttribute("aria-checked")).toBe("true");
		fireEvent.click(sw);

		await waitFor(() =>
			expect(toggle).toHaveBeenCalledWith("skill-1", false),
		);
		await waitFor(() =>
			expect(sw.getAttribute("aria-checked")).toBe("false"),
		);
	});

	it("rolls back the switch and surfaces an error on API failure", async () => {
		toggle.mockReset().mockRejectedValue(new Error("nope"));
		render(<SkillsPanel />);
		await waitFor(() => expect(list).toHaveBeenCalled());
		const sw = await screen.findByRole("switch");
		fireEvent.click(sw);
		await waitFor(() => expect(toggle).toHaveBeenCalled());
		await waitFor(() => {
			// rolled back to original (true) and error visible
			expect(sw.getAttribute("aria-checked")).toBe("true");
			expect(screen.getByText("nope")).toBeDefined();
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
