import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const list = vi.fn();
const ingest = vi.fn();
const search = vi.fn();
const del = vi.fn();
vi.mock("../../services/knowledge", () => ({
	knowledgeApi: {
		list: () => list(),
		ingest: (p: unknown) => ingest(p),
		search: (q: string, k?: number) => search(q, k),
		delete: (id: string) => del(id),
	},
}));

const setDraft = vi.fn();
const closeSettings = vi.fn();
vi.mock("../../stores/conversationStore", () => ({
	useConversationStore: <T,>(sel: (s: unknown) => T): T => sel({ setDraft }),
}));
vi.mock("../../stores/settingsStore", () => ({
	useSettingsStore: <T,>(sel: (s: unknown) => T): T => sel({ closeSettings }),
}));

import KnowledgePanel from "./KnowledgePanel";

const docFixture = {
	id: "k1",
	title: "Tauri Notes",
	file_type: "text",
	chunk_count: 3,
	size_bytes: 4096,
	created_at: "",
};

beforeEach(() => {
	list.mockReset().mockResolvedValue([docFixture]);
	ingest.mockReset().mockResolvedValue({ ...docFixture, id: "k2" });
	search.mockReset().mockResolvedValue({ results: [], query: "" });
	del.mockReset().mockResolvedValue(undefined);
	setDraft.mockReset();
	closeSettings.mockReset();
});

afterEach(cleanup);

describe("KnowledgePanel", () => {
	it("renders the document list returned as a flat array (regression)", async () => {
		// The bug: service used to return {documents,total} which didn't match
		// engine. The fix: service returns KnowledgeDoc[]. This test asserts
		// the panel handles that shape.
		render(<KnowledgePanel />);
		await waitFor(() => expect(list).toHaveBeenCalled());
		await waitFor(() => {
			expect(screen.getByText("Tauri Notes")).toBeDefined();
		});
		expect(screen.getByText(/3 chunks/)).toBeDefined();
	});

	it("ingest button posts to knowledgeApi.ingest then refreshes the list", async () => {
		render(<KnowledgePanel />);
		await waitFor(() => expect(list).toHaveBeenCalledTimes(1));

		fireEvent.click(screen.getByText("Add"));
		fireEvent.change(screen.getByPlaceholderText("Title"), {
			target: { value: "doc" },
		});
		fireEvent.change(screen.getByPlaceholderText(/Paste document content/), {
			target: { value: "hello" },
		});
		fireEvent.click(screen.getByText("Ingest"));

		await waitFor(() =>
			expect(ingest).toHaveBeenCalledWith({ title: "doc", content: "hello" }),
		);
		await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
	});

	it("search Enter triggers knowledgeApi.search with the query and renders chunks", async () => {
		search.mockResolvedValueOnce({
			results: [
				{
					id: "ch1",
					document_id: "k1",
					content: "EncoreHub uses Tauri.",
					chunk_index: 0,
					score: 0.91,
				},
			],
			query: "Tauri",
		});

		render(<KnowledgePanel />);
		const input = screen.getByPlaceholderText(/Search chunks/);
		fireEvent.change(input, { target: { value: "Tauri" } });
		fireEvent.keyDown(input, { key: "Enter" });

		await waitFor(() => expect(search).toHaveBeenCalledWith("Tauri", 10));
		await waitFor(() => {
			expect(screen.getByText(/EncoreHub uses Tauri\./)).toBeDefined();
			expect(screen.getByText(/score 0\.910/)).toBeDefined();
		});
	});

	it("delete trash icon removes the row optimistically", async () => {
		render(<KnowledgePanel />);
		await waitFor(() => expect(screen.getByText("Tauri Notes")).toBeDefined());

		const trash = screen.getByTitle("Delete");
		fireEvent.click(trash);

		await waitFor(() => expect(del).toHaveBeenCalledWith("k1"));
		await waitFor(() => {
			expect(screen.queryByText("Tauri Notes")).toBeNull();
		});
	});
});
