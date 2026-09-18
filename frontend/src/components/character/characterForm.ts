// Character draft helpers: limits, validation, copy names, and token estimates.

import { t } from "../../i18n";
import type {
	CharacterProfile,
	CharacterProfileInput,
} from "../../services/characters";

/** Field length limits enforced by the editor and the Engine profile contract. */
export const CHARACTER_LIMITS = {
	name: 100,
	avatar: 4096,
	description: 16_384,
	systemPrompt: 65_536,
	openingMessage: 16_384,
	tags: 50,
	tag: 64,
} as const;

/** Editable character fields held in the manager form. */
export interface CharacterDraft {
	name: string;
	avatar: string;
	description: string;
	systemPrompt: string;
	defaultProvider: string;
	defaultModel: string;
	openingMessage: string;
	tags: string;
}

/** Per-field validation messages for a character draft. */
export type CharacterDraftErrors = Partial<
	Record<keyof CharacterDraft, string>
>;

/** Empty draft used when creating a character. */
export function emptyCharacterDraft(): CharacterDraft {
	return {
		name: "",
		avatar: "",
		description: "",
		systemPrompt: "",
		defaultProvider: "",
		defaultModel: "",
		openingMessage: "",
		tags: "",
	};
}

/** Copy a stored profile into editor draft fields. */
export function draftFromCharacter(profile: CharacterProfile): CharacterDraft {
	return {
		name: profile.name,
		avatar: profile.avatar,
		description: profile.description,
		systemPrompt: profile.system_prompt,
		defaultProvider: profile.default_provider,
		defaultModel: profile.default_model,
		openingMessage: profile.opening_message,
		tags: profile.tags.join(", "),
	};
}

/** Split, trim, and de-duplicate tags from a comma-separated input. */
export function parseCharacterTags(value: string): string[] {
	const seen = new Set<string>();
	return value
		.split(/[,，]/)
		.map((tag) => tag.trim())
		.filter((tag) => {
			if (!tag) return false;
			const key = tag.toLocaleLowerCase();
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
}

/** Map a draft onto the Engine create/update payload. */
export function characterInputFromDraft(
	draft: CharacterDraft,
): CharacterProfileInput {
	return {
		name: draft.name.trim(),
		avatar: draft.avatar.trim(),
		description: draft.description.trim(),
		system_prompt: draft.systemPrompt.trim(),
		default_provider: draft.defaultProvider.trim(),
		default_model: draft.defaultModel.trim(),
		opening_message: draft.openingMessage.trim(),
		tags: parseCharacterTags(draft.tags),
	};
}

function characterCount(value: string): number {
	return Array.from(value).length;
}

/**
 * Validate identity, prompt, tags, and provider/model pairing.
 *
 * Messages are translated at call time so a locale switch refreshes errors.
 */
export function validateCharacterDraft(
	draft: CharacterDraft,
	characters: CharacterProfile[],
	currentId: string | null,
): CharacterDraftErrors {
	const errors: CharacterDraftErrors = {};
	const name = draft.name.trim();
	const normalizedName = name.toLocaleLowerCase();

	if (!name) errors.name = t("character.validation.nameRequired");
	else if (characterCount(name) > CHARACTER_LIMITS.name) {
		errors.name = t("character.validation.nameMax", {
			count: CHARACTER_LIMITS.name,
		});
	} else if (
		characters.some(
			(profile) =>
				profile.id !== currentId &&
				profile.name.trim().toLocaleLowerCase() === normalizedName,
		)
	) {
		errors.name = t("character.validation.nameExists");
	}

	if (characterCount(draft.avatar) > CHARACTER_LIMITS.avatar) {
		errors.avatar = t("character.validation.avatarMax", {
			count: CHARACTER_LIMITS.avatar,
		});
	}
	if (characterCount(draft.description) > CHARACTER_LIMITS.description) {
		errors.description = t("character.validation.descriptionMax", {
			count: CHARACTER_LIMITS.description.toLocaleString(),
		});
	}
	if (characterCount(draft.systemPrompt) > CHARACTER_LIMITS.systemPrompt) {
		errors.systemPrompt = t("character.validation.promptMax", {
			count: CHARACTER_LIMITS.systemPrompt.toLocaleString(),
		});
	}
	if (characterCount(draft.openingMessage) > CHARACTER_LIMITS.openingMessage) {
		errors.openingMessage = t("character.validation.openingMax", {
			count: CHARACTER_LIMITS.openingMessage.toLocaleString(),
		});
	}
	if (draft.defaultProvider && !draft.defaultModel) {
		errors.defaultModel = t("character.validation.chooseModel");
	}
	if (!draft.defaultProvider && draft.defaultModel) {
		errors.defaultProvider = t("character.validation.chooseProvider");
	}

	const tags = parseCharacterTags(draft.tags);
	if (tags.length > CHARACTER_LIMITS.tags) {
		errors.tags = t("character.validation.tagsMax", {
			count: CHARACTER_LIMITS.tags,
		});
	} else if (tags.some((tag) => characterCount(tag) > CHARACTER_LIMITS.tag)) {
		errors.tags = t("character.validation.tagMax", {
			count: CHARACTER_LIMITS.tag,
		});
	}
	return errors;
}

/** Stable signature used to detect unsaved draft changes. */
export function characterDraftSignature(draft: CharacterDraft): string {
	return JSON.stringify(characterInputFromDraft(draft));
}

/** Rough UTF-8 token estimate for the global prompt preview. */
export function estimatePromptTokens(prompt: string): number {
	if (!prompt) return 0;
	return Math.ceil(new TextEncoder().encode(prompt).length / 4);
}

/**
 * Build a unique duplicate name using locale copy suffixes.
 *
 * English suffixes stay `" copy"` / `" copy {n}"` so existing names still match.
 */
export function uniqueCopyName(
	name: string,
	characters: CharacterProfile[],
): string {
	const existing = new Set(
		characters.map((profile) => profile.name.trim().toLocaleLowerCase()),
	);
	const source = name.trim() || t("character.fallbackName");
	const candidate = (suffix: string) => {
		const available = CHARACTER_LIMITS.name - characterCount(suffix);
		const base = Array.from(source).slice(0, available).join("").trimEnd();
		return `${base}${suffix}`;
	};
	const root = candidate(t("character.copySuffix"));
	if (!existing.has(root.toLocaleLowerCase())) return root;
	for (let index = 2; index < 10_000; index += 1) {
		const numbered = candidate(t("character.copySuffixN", { n: index }));
		if (!existing.has(numbered.toLocaleLowerCase())) return numbered;
	}
	return candidate(t("character.copySuffixN", { n: Date.now() }));
}
