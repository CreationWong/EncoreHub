import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const list = vi.fn();
const search = vi.fn();
const del = vi.fn();
vi.mock("../../services/memories", () => ({
	memoriesApi: {
		list: (scope?: string) => list(scope),
		search: (opts: unknown) => search(opts),
		delete: (id: string) => del(id),
	},
}));

const setDraft = vi.fn();
const closeSettings = vi.fn();
vi.mock("../../stores/conversationStore", () => ({
	useConversationStore: <T,>(sel: (s: unknown) => T): T =>
		sel({ setDraft }),
}));
vi.mock("../../stores/settingsStore", () => ({
	useSettingsStore: <T,>(sel: (s: unknown) => T): T =>
		sel({ closeSettings }),
}));

import MemoryPanel from "./MemoryPanel";

const memFixture = {
	id: "m1",
	scope: "global",
	memory_type: "semantic",
	conversation_id: null,
	content: "EncoreHub uses Tauri for the desktop shell.",
	importance: 0.8,
	created_at: "",
	last_accessed_at: "",
};

beforeEach(() => {
	list.mockReset().mockResolvedValue({ memories: [memFixture], total: 1 });
	search
		.mockReset()
		.mockResolvedValue({ results: [memFixture], query: "Tauri" });
	del.mockReset().mockResolvedValue(undefined);
	setDraft.mockReset();
	closeSettings.mockReset();
});

afterEach(cleanup);

describe("MemoryPanel", () => {
	it("renders the list returned by memoriesApi.list", async () => {
		render(<MemoryPanel />);
		await waitFor(() => expect(list).toHaveBeenCalled());
		await waitFor(() => {
			expect(screen.getByText(/EncoreHub uses Tauri/)).toBeDefined();
			expect(screen.getByText("global")).toBeDefined();
		});
	});

	it("Enter on the search box hits memoriesApi.search with q + top_k", async () => {
		render(<MemoryPanel />);
		await waitFor(() => expect(list).toHaveBeenCalledTimes(1));

		const input = screen.getByPlaceholderText(/Search memories/);
		fireEvent.change(input, { target: { value: "Tauri" } });
		fireEvent.keyDown(input, { key: "Enter" });

		await waitFor(() =>
			expect(search).toHaveBeenCalledWith({
				q: "Tauri",
				scope: undefined,
				top_k: 30,
			}),
		);
	});

	it("Quote button writes setDraft and closes Settings", async () => {
		render(<MemoryPanel />);
		await waitFor(() => screen.getByText(/EncoreHub uses Tauri/));
		fireEvent.click(screen.getByTitle("Quote into chat input"));
		expect(setDraft).toHaveBeenCalledWith(
			"> [memory] EncoreHub uses Tauri for the desktop shell.",
		);
		expect(closeSettings).toHaveBeenCalled();
	});

	it("Delete button removes the row optimistically", async () => {
		render(<MemoryPanel />);
		await waitFor(() => screen.getByText(/EncoreHub uses Tauri/));
		fireEvent.click(screen.getByTitle("Delete"));
		await waitFor(() => expect(del).toHaveBeenCalledWith("m1"));
		await waitFor(() =>
			expect(screen.queryByText(/EncoreHub uses Tauri/)).toBeNull(),
		);
	});
});
