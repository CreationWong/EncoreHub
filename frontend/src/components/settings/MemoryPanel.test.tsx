// Interaction tests for role-scoped memory settings and group management.

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const list = vi.fn();
const search = vi.fn();
const del = vi.fn();
const listGroups = vi.fn();
const getCharacterSettings = vi.fn();
const updateCharacterSettings = vi.fn();
const createGroup = vi.fn();
const updateGroup = vi.fn();
const deleteGroup = vi.fn();
vi.mock("../../services/memories", () => ({
	memoriesApi: {
		list: (options?: unknown) => list(options),
		search: (opts: unknown) => search(opts),
		delete: (id: string) => del(id),
		listGroups: () => listGroups(),
		getCharacterSettings: (id: string) => getCharacterSettings(id),
		updateCharacterSettings: (id: string, input: unknown) =>
			updateCharacterSettings(id, input),
		createGroup: (name: string) => createGroup(name),
		updateGroup: (id: string, input: unknown) => updateGroup(id, input),
		deleteGroup: (id: string, input: unknown) => deleteGroup(id, input),
	},
}));

const characterFixture = {
	id: "default",
	name: "Default character",
	avatar: "",
	description: "",
	system_prompt: "",
	default_provider: "",
	default_model: "",
	opening_message: "",
	tags: [],
	version: 1,
	revision: 1,
	active_branch: "main",
	created_at: "",
	updated_at: "",
	deleted_at: null,
};
vi.mock("../../services/characters", () => ({
	listCharacters: () =>
		Promise.resolve({ characters: [characterFixture], total: 1 }),
}));

const setDraft = vi.fn();
const closeSettings = vi.fn();
vi.mock("../../stores/conversationStore", () => ({
	useConversationStore: <T,>(sel: (s: unknown) => T): T => sel({ setDraft }),
}));
vi.mock("../../stores/settingsStore", () => ({
	useSettingsStore: <T,>(sel: (s: unknown) => T): T => sel({ closeSettings }),
}));

import MemoryPanel from "./MemoryPanel";

const memFixture = {
	id: "m1",
	scope: "global",
	memory_type: "semantic",
	conversation_id: null,
	group_id: "character:default",
	source_character_id: "default",
	state: "long_term",
	kind: "fact",
	content: "EncoreHub uses Tauri for the desktop shell.",
	importance: 0.8,
	created_at: "",
	last_accessed_at: "",
};

const characterGroup = {
	id: "character:default",
	profile_id: "local",
	name: "Default character",
	group_type: "character",
	owner_character_id: "default",
	archived_at: null,
	created_at: "",
	updated_at: "",
};

const customGroup = {
	...characterGroup,
	id: "custom:project",
	name: "Project shared",
	group_type: "custom",
	owner_character_id: null,
};

const settingsFixture = {
	settings: {
		character_id: "default",
		default_mode: "simple",
		realistic_enabled: false,
		updated_at: "",
	},
	inherited_groups: [],
	visible_group_ids: ["character:default", "global"],
};

beforeEach(() => {
	list.mockReset().mockResolvedValue({ memories: [memFixture], total: 1 });
	search
		.mockReset()
		.mockResolvedValue({ results: [memFixture], query: "Tauri" });
	del.mockReset().mockResolvedValue(undefined);
	listGroups
		.mockReset()
		.mockResolvedValue({ groups: [characterGroup, customGroup], total: 2 });
	getCharacterSettings.mockReset().mockResolvedValue(settingsFixture);
	updateCharacterSettings.mockReset().mockResolvedValue(settingsFixture);
	createGroup.mockReset().mockImplementation((name: string) =>
		Promise.resolve({
			...customGroup,
			id: "custom:new",
			name,
		}),
	);
	updateGroup.mockReset();
	deleteGroup.mockReset();
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
			expect(screen.getByText("fact")).toBeDefined();
			expect(screen.getByText("long_term")).toBeDefined();
		});
	});

	it("Enter on the search box hits memoriesApi.search with q + top_k", async () => {
		render(<MemoryPanel />);
		await waitFor(() =>
			expect(screen.getByText(/EncoreHub uses Tauri/)).toBeDefined(),
		);

		const input = screen.getByPlaceholderText(/Search memories/);
		fireEvent.change(input, { target: { value: "Tauri" } });
		fireEvent.keyDown(input, { key: "Enter" });

		await waitFor(() =>
			expect(search).toHaveBeenCalledWith({
				q: "Tauri",
				group_id: "character:default",
				top_k: 30,
			}),
		);
	});

	it("saves role mode and inherited groups separately from memory type", async () => {
		render(<MemoryPanel />);
		await waitFor(() =>
			expect(getCharacterSettings).toHaveBeenCalledWith("default"),
		);

		fireEvent.change(screen.getByLabelText("Default mode"), {
			target: { value: "rag" },
		});
		fireEvent.click(screen.getByRole("checkbox"));
		fireEvent.click(screen.getByText("Save"));

		await waitFor(() =>
			expect(updateCharacterSettings).toHaveBeenCalledWith("default", {
				default_mode: "rag",
				realistic_enabled: false,
				inherited_groups: [
					{
						character_id: "default",
						group_id: "custom:project",
						access_mode: "read",
						priority: 0,
					},
				],
			}),
		);
	});

	it("creates a custom group from the group navigation", async () => {
		render(<MemoryPanel />);
		await waitFor(() => expect(listGroups).toHaveBeenCalled());

		fireEvent.click(screen.getByTitle("Create group"));
		fireEvent.change(screen.getByLabelText("Memory group name"), {
			target: { value: "Shared research" },
		});
		fireEvent.click(screen.getByTitle("Save"));

		await waitFor(() =>
			expect(createGroup).toHaveBeenCalledWith("Shared research"),
		);
		await waitFor(() =>
			expect(screen.getAllByText("Shared research").length).toBeGreaterThan(0),
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
