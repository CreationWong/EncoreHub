import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	deleteKey: vi.fn(),
	getSettings: vi.fn(),
	listSecrets: vi.fn(),
	putKey: vi.fn(),
	saveSettings: vi.fn(),
	testSearch: vi.fn(),
}));

vi.mock("../../services/secrets", () => ({
	secretsApi: {
		deleteKey: (...args: unknown[]) => mocks.deleteKey(...args),
		list: (...args: unknown[]) => mocks.listSecrets(...args),
		putKey: (...args: unknown[]) => mocks.putKey(...args),
	},
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
	mocks.deleteKey.mockReset().mockResolvedValue(undefined);
	mocks.getSettings.mockReset().mockResolvedValue(DEFAULT_WEB_SEARCH_SETTINGS);
	mocks.listSecrets.mockReset().mockResolvedValue({
		provider_ids: ["system.search.google"],
	});
	mocks.putKey.mockReset().mockResolvedValue(undefined);
	mocks.saveSettings.mockReset().mockResolvedValue(undefined);
	mocks.testSearch.mockReset().mockResolvedValue({
		provider: "Custom search",
		query: "EncoreHub",
		results: [{ title: "EncoreHub", url: "https://example.com", snippet: "" }],
	});
	useSettingsStore.setState({
		searchEnabled: false,
		searchProvider: "duckduckgo",
		searchMaxResults: 5,
		googleSearchEngineId: "",
		customSearchSettings: { ...DEFAULT_WEB_SEARCH_SETTINGS.custom },
		searchSettingsLoaded: true,
	});
});

afterEach(cleanup);

describe("SearchPanel", () => {
	it("shows all built-in and custom search providers in the provider list", async () => {
		render(<SearchPanel />);

		for (const provider of [
			"DuckDuckGo",
			"Bing Web Search",
			"Google Custom Search",
			"Custom JSON endpoint",
		]) {
			expect(
				screen.getByRole("button", { name: `Configure ${provider}` }),
			).toBeDefined();
		}
		expect(
			screen.getByRole("switch", { name: "Enable web search by default" }),
		).toBeDefined();
		await waitFor(() => expect(mocks.listSecrets).toHaveBeenCalledOnce());
	});

	it("stores Google credentials separately from ordinary configuration", async () => {
		render(<SearchPanel />);
		fireEvent.click(
			screen.getByRole("button", { name: "Configure Google Custom Search" }),
		);
		fireEvent.click(screen.getByRole("button", { name: "Set as default" }));
		fireEvent.change(screen.getByLabelText("Programmable Search Engine ID"), {
			target: { value: "engine-123" },
		});
		fireEvent.change(screen.getByLabelText("Google API key"), {
			target: { value: "secret-key" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await waitFor(() =>
			expect(mocks.putKey).toHaveBeenCalledWith(
				"system.search.google",
				"secret-key",
			),
		);
		expect(mocks.saveSettings).toHaveBeenCalledWith(
			expect.objectContaining({
				provider: "google",
				google_cse_id: "engine-123",
			}),
		);
	});

	it("saves and tests a custom JSON endpoint", async () => {
		render(<SearchPanel />);
		fireEvent.click(
			screen.getByRole("button", { name: "Configure Custom JSON endpoint" }),
		);
		fireEvent.change(screen.getByLabelText("Endpoint URL"), {
			target: { value: "https://search.example.com/api" },
		});
		fireEvent.click(screen.getByText("Response mapping"));
		fireEvent.change(screen.getByLabelText("Results array path"), {
			target: { value: "data.items" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

		await waitFor(() =>
			expect(mocks.testSearch).toHaveBeenCalledWith("custom", 5),
		);
		expect(mocks.saveSettings).toHaveBeenCalledWith(
			expect.objectContaining({
				custom: expect.objectContaining({
					endpoint: "https://search.example.com/api",
					results_path: "data.items",
				}),
			}),
		);
	});

	it("uses the same list-to-detail navigation as model providers on compact screens", () => {
		render(<SearchPanel />);

		const detailPane = document.querySelector(
			'[data-mobile-pane="search-provider-detail"]',
		);
		expect(detailPane?.className).toContain("max-[700px]:hidden");

		fireEvent.click(
			screen.getByRole("button", { name: "Configure Bing Web Search" }),
		);
		expect(detailPane?.className).not.toContain("max-[700px]:hidden");

		fireEvent.click(
			screen.getByRole("button", { name: "Back to search providers" }),
		);
		expect(detailPane?.className).toContain("max-[700px]:hidden");
	});
});
