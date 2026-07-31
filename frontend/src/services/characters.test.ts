import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
vi.mock("./api", () => ({
	apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

import {
	commitCharacterVersion,
	createCharacter,
	createCharacterBranch,
	deleteCharacter,
	getCharacter,
	listCharacterHistories,
	listCharacters,
	previewCharacterUpgrade,
	restoreCharacterVersion,
	updateCharacter,
	upgradeConversationCharacter,
} from "./characters";

beforeEach(() => apiFetch.mockReset().mockResolvedValue(undefined));

describe("characters service", () => {
	it("exposes character CRUD through encoded gateway routes", async () => {
		await listCharacters();
		await getCharacter("role/one");
		await createCharacter({ name: "Archivist", tags: ["research"] });
		await updateCharacter("role/one", 3, { system_prompt: "Use sources" });
		await deleteCharacter("role/one");

		expect(apiFetch.mock.calls[0]).toEqual(["/characters"]);
		expect(apiFetch.mock.calls[1]).toEqual(["/characters/role%2Fone"]);
		expect(JSON.parse(apiFetch.mock.calls[2][1].body)).toEqual({
			name: "Archivist",
			tags: ["research"],
		});
		expect(JSON.parse(apiFetch.mock.calls[3][1].body)).toEqual({
			expected_revision: 3,
			system_prompt: "Use sources",
		});
		expect(apiFetch.mock.calls[4]).toEqual([
			"/characters/role%2Fone",
			{ method: "DELETE" },
		]);
	});

	it("exposes explicit character history operations", async () => {
		await listCharacterHistories();
		await commitCharacterVersion("role/one", 4, "Stable prompt");
		await createCharacterBranch("role/one", 5, "experiment", 2);
		await restoreCharacterVersion("role/one", 6, 1);

		expect(apiFetch.mock.calls[0]).toEqual(["/characters/history"]);
		expect(apiFetch.mock.calls[1][0]).toBe("/characters/role%2Fone/versions");
		expect(JSON.parse(apiFetch.mock.calls[1][1].body)).toEqual({
			expected_revision: 4,
			message: "Stable prompt",
		});
		expect(JSON.parse(apiFetch.mock.calls[2][1].body)).toEqual({
			expected_revision: 5,
			name: "experiment",
			from_version: 2,
		});
		expect(apiFetch.mock.calls[3][0]).toBe(
			"/characters/role%2Fone/versions/1/restore",
		);
	});

	it("previews and explicitly applies conversation character upgrades", async () => {
		await previewCharacterUpgrade("conversation/one");
		await upgradeConversationCharacter("conversation/one", 2);

		expect(apiFetch.mock.calls[0]).toEqual([
			"/conversations/conversation%2Fone/character-upgrade",
		]);
		expect(apiFetch.mock.calls[1][0]).toBe(
			"/conversations/conversation%2Fone/character-upgrade",
		);
		expect(JSON.parse(apiFetch.mock.calls[1][1].body)).toEqual({
			expected_character_version: 2,
		});
	});
});
