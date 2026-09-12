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
const chunks = vi.fn();
vi.mock("../../services/knowledge", () => ({
	knowledgeApi: {
		list: (options?: unknown) => list(options),
		ingest: (p: unknown) => ingest(p),
		search: (q: string, k?: number) => search(q, k),
		delete: (id: string) => del(id),
		chunks: (id: string) => chunks(id),
	},
}));

const confirmAsk = vi.fn();
vi.mock("../../stores/confirmStore", () => ({
	confirm: { ask: (...args: unknown[]) => confirmAsk(...args) },
}));

const appendDraft = vi.fn();
const closeSettings = vi.fn();
vi.mock("../../stores/conversationStore", () => ({
	useConversationStore: <T,>(sel: (s: unknown) => T): T => sel({ appendDraft }),
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
	created_at: "2026-08-01T00:00:00.000Z",
};

beforeEach(() => {
	list.mockReset().mockResolvedValue([docFixture]);
	ingest.mockReset().mockResolvedValue({ ...docFixture, id: "k2" });
	search
		.mockReset()
		.mockResolvedValue({ results: [], query: "", backend: "lance_db" });
	del.mockReset().mockResolvedValue(undefined);
	chunks.mockReset().mockResolvedValue([
		{
			id: "c1",
			document_id: "k1",
			content: "EncoreHub uses Tauri.",
			chunk_index: 0,
			token_count: 5,
		},
	]);
	confirmAsk.mockReset().mockResolvedValue(true);
	appendDraft.mockReset();
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
			backend: "lance_db",
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
		// The serving vector backend is surfaced next to the results.
		expect(screen.getByText("LanceDB")).toBeDefined();
	});

	it("filters the browse list by title through knowledgeApi.list", async () => {
		render(<KnowledgePanel />);
		await waitFor(() => expect(list).toHaveBeenCalledTimes(1));

		const filter = screen.getByLabelText("Filter documents by title");
		fireEvent.change(filter, { target: { value: "Tauri" } });
		fireEvent.keyDown(filter, { key: "Enter" });

		await waitFor(() => expect(list).toHaveBeenLastCalledWith({ q: "Tauri" }));
	});

	it("expands a document to load and show its chunks", async () => {
		render(<KnowledgePanel />);
		await waitFor(() => screen.getByText("Tauri Notes"));

		fireEvent.click(screen.getByRole("button", { name: /Expand Tauri Notes/ }));

		await waitFor(() => expect(chunks).toHaveBeenCalledWith("k1"));
		await waitFor(() =>
			expect(screen.getByText(/chunk #0 · 5 tokens/)).toBeDefined(),
		);
	});

	it("confirms before deleting and removes the row on success", async () => {
		render(<KnowledgePanel />);
		await waitFor(() => expect(screen.getByText("Tauri Notes")).toBeDefined());

		fireEvent.click(screen.getByTitle("Delete"));

		await waitFor(() => expect(confirmAsk).toHaveBeenCalled());
		await waitFor(() => expect(del).toHaveBeenCalledWith("k1"));
		await waitFor(() => {
			expect(screen.queryByText("Tauri Notes")).toBeNull();
		});
	});

	it("keeps the document when deletion is cancelled", async () => {
		confirmAsk.mockResolvedValueOnce(false);
		render(<KnowledgePanel />);
		await waitFor(() => expect(screen.getByText("Tauri Notes")).toBeDefined());

		fireEvent.click(screen.getByTitle("Delete"));

		await waitFor(() => expect(confirmAsk).toHaveBeenCalled());
		expect(del).not.toHaveBeenCalled();
		expect(screen.getByText("Tauri Notes")).toBeDefined();
	});
});
