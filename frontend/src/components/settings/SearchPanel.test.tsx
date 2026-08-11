import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getSettings: vi.fn(),
	saveSettings: vi.fn(),
	testSearch: vi.fn(),
}));

vi.mock("../../services/webSearch", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../services/webSearch")>();
	return {
		...actual,
		webSearchApi: {
			getSettings: (...args: unknown[]) => mocks.getSettings(...args),
			saveSettings: (...args: unknown[]) => mocks.saveSettings(...args),
			test: (...args: unknown[]) => mocks.testSearch(...args),
		},
	};
});

import { DEFAULT_WEB_SEARCH_SETTINGS } from "../../services/webSearch";
import { useSettingsStore } from "../../stores/settingsStore";
import SearchPanel from "./SearchPanel";

beforeEach(() => {
	mocks.getSettings.mockReset().mockResolvedValue(DEFAULT_WEB_SEARCH_SETTINGS);
	mocks.saveSettings.mockReset().mockResolvedValue(undefined);
	mocks.testSearch.mockReset().mockResolvedValue({
		provider: "searxng",
		query: "EncoreHub",
		results: [],
	});
	useSettingsStore.setState({
		searchEnabled: false,
		searchProvider: "duckduckgo",
		searchMaxResults: 5,
		searXNGSearchSettings: { ...DEFAULT_WEB_SEARCH_SETTINGS.searxng },
		openSERPSearchSettings: { ...DEFAULT_WEB_SEARCH_SETTINGS.openserp },
		searchSettingsLoaded: true,
	});
});

afterEach(cleanup);

describe("SearchPanel", () => {
	it("shows the explicit search providers", () => {
		render(<SearchPanel />);
		for (const provider of ["DuckDuckGo", "SearXNG", "OpenSERP"]) {
			expect(
				screen.getByRole("button", { name: `Configure ${provider}` }),
			).toBeDefined();
		}
		expect(screen.queryByText("Google Custom Search")).toBeNull();
		expect(screen.queryByText("Browser mode")).toBeNull();
	});

	it("tests combined DuckDuckGo without custom configuration", async () => {
		render(<SearchPanel />);
		expect(
			screen.getByText(
				"HTML web results with featured Instant Answer summaries",
			),
		).toBeDefined();
		fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
		await waitFor(() =>
			expect(mocks.testSearch).toHaveBeenCalledWith("duckduckgo", 5),
		);
	});

	it("saves and tests a SearXNG endpoint", async () => {
		render(<SearchPanel />);
		fireEvent.click(screen.getByRole("button", { name: "Configure SearXNG" }));
		fireEvent.change(screen.getByLabelText("SearXNG endpoint"), {
			target: { value: "http://127.0.0.1:8888" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Set as default" }));
		fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
		await waitFor(() =>
			expect(mocks.testSearch).toHaveBeenCalledWith("searxng", 5),
		);
		expect(mocks.saveSettings).toHaveBeenCalledWith(
			expect.objectContaining({
				provider: "searxng",
				searxng: { endpoint: "http://127.0.0.1:8888" },
			}),
		);
	});

	it("configures OpenSERP mega search", async () => {
		render(<SearchPanel />);
		fireEvent.click(screen.getByRole("button", { name: "Configure OpenSERP" }));
		fireEvent.change(screen.getByLabelText("OpenSERP endpoint"), {
			target: { value: "http://localhost:7000" },
		});
		fireEvent.change(screen.getByLabelText("Mega search engines"), {
			target: { value: "google,bing" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		await waitFor(() =>
			expect(mocks.saveSettings).toHaveBeenCalledWith(
				expect.objectContaining({
					openserp: {
						endpoint: "http://localhost:7000",
						engine: "mega",
						engines: "google,bing",
					},
				}),
			),
		);
	});

	it("keeps compact list-to-detail navigation", () => {
		render(<SearchPanel />);
		const detail = document.querySelector(
			'[data-mobile-pane="search-provider-detail"]',
		);
		expect(detail?.className).toContain("max-[700px]:hidden");
		fireEvent.click(screen.getByRole("button", { name: "Configure SearXNG" }));
		expect(detail?.className).not.toContain("max-[700px]:hidden");
		fireEvent.click(
			screen.getByRole("button", { name: "Back to search providers" }),
		);
		expect(detail?.className).toContain("max-[700px]:hidden");
	});
});
