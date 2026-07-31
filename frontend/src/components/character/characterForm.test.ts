import { describe, expect, it } from "vitest";
import type { CharacterProfile } from "../../services/characters";
import {
	characterInputFromDraft,
	emptyCharacterDraft,
	estimatePromptTokens,
	parseCharacterTags,
	uniqueCopyName,
	validateCharacterDraft,
} from "./characterForm";

function profile(name: string, id = name): CharacterProfile {
	return {
		id,
		name,
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
}

describe("character form helpers", () => {
	it("normalizes tags and serialized profile fields", () => {
		const draft = {
			...emptyCharacterDraft(),
			name: "  Archivist  ",
			tags: "Research, 中文，research, release",
			defaultProvider: " anthropic ",
			defaultModel: " claude-sonnet-4 ",
		};

		expect(parseCharacterTags(draft.tags)).toEqual([
			"Research",
			"中文",
			"release",
		]);
		expect(characterInputFromDraft(draft)).toMatchObject({
			name: "Archivist",
			default_provider: "anthropic",
			default_model: "claude-sonnet-4",
		});
	});

	it("detects case-insensitive name conflicts and incomplete model pairs", () => {
		const draft = {
			...emptyCharacterDraft(),
			name: " archivist ",
			defaultProvider: "anthropic",
		};
		const errors = validateCharacterDraft(
			draft,
			[profile("Archivist", "existing")],
			null,
		);

		expect(errors.name).toContain("already exists");
		expect(errors.defaultModel).toContain("Choose a model");
	});

	it("allows an existing profile to keep its own name", () => {
		const draft = { ...emptyCharacterDraft(), name: "Archivist" };
		expect(
			validateCharacterDraft(
				draft,
				[profile("Archivist", "existing")],
				"existing",
			).name,
		).toBeUndefined();
	});

	it("labels the UTF-8 token estimate as a deterministic approximation", () => {
		expect(estimatePromptTokens("abcd")).toBe(1);
		expect(estimatePromptTokens("角色")).toBe(2);
		expect(estimatePromptTokens("")).toBe(0);
	});

	it("creates a non-conflicting copy name", () => {
		const characters = [profile("Archivist"), profile("Archivist copy")];
		expect(uniqueCopyName("Archivist", characters)).toBe("Archivist copy 2");
	});

	it("keeps copied CJK names within the profile name limit", () => {
		const source = "角".repeat(100);
		const copy = uniqueCopyName(source, [profile(source)]);

		expect(Array.from(copy)).toHaveLength(100);
		expect(copy.endsWith(" copy")).toBe(true);
	});
});
