import type {
	CharacterProfile,
	CharacterProfileInput,
} from "../../services/characters";

export const CHARACTER_LIMITS = {
	name: 100,
	avatar: 4096,
	description: 16_384,
	systemPrompt: 65_536,
	openingMessage: 16_384,
	tags: 50,
	tag: 64,
} as const;

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

export type CharacterDraftErrors = Partial<
	Record<keyof CharacterDraft, string>
>;

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

export function validateCharacterDraft(
	draft: CharacterDraft,
	characters: CharacterProfile[],
	currentId: string | null,
): CharacterDraftErrors {
	const errors: CharacterDraftErrors = {};
	const name = draft.name.trim();
	const normalizedName = name.toLocaleLowerCase();

	if (!name) errors.name = "Name is required.";
	else if (characterCount(name) > CHARACTER_LIMITS.name) {
		errors.name = `Name must be ${CHARACTER_LIMITS.name} characters or fewer.`;
	} else if (
		characters.some(
			(profile) =>
				profile.id !== currentId &&
				profile.name.trim().toLocaleLowerCase() === normalizedName,
		)
	) {
		errors.name = "A character with this name already exists.";
	}

	if (characterCount(draft.avatar) > CHARACTER_LIMITS.avatar) {
		errors.avatar = `Avatar must be ${CHARACTER_LIMITS.avatar} characters or fewer.`;
	}
	if (characterCount(draft.description) > CHARACTER_LIMITS.description) {
		errors.description = `Description must be ${CHARACTER_LIMITS.description.toLocaleString()} characters or fewer.`;
	}
	if (characterCount(draft.systemPrompt) > CHARACTER_LIMITS.systemPrompt) {
		errors.systemPrompt = `Prompt must be ${CHARACTER_LIMITS.systemPrompt.toLocaleString()} characters or fewer.`;
	}
	if (characterCount(draft.openingMessage) > CHARACTER_LIMITS.openingMessage) {
		errors.openingMessage = `Opening message must be ${CHARACTER_LIMITS.openingMessage.toLocaleString()} characters or fewer.`;
	}
	if (draft.defaultProvider && !draft.defaultModel) {
		errors.defaultModel =
			"Choose a model or use the app default for both fields.";
	}
	if (!draft.defaultProvider && draft.defaultModel) {
		errors.defaultProvider =
			"Choose a provider or use the app default for both fields.";
	}

	const tags = parseCharacterTags(draft.tags);
	if (tags.length > CHARACTER_LIMITS.tags) {
		errors.tags = `Use no more than ${CHARACTER_LIMITS.tags} tags.`;
	} else if (tags.some((tag) => characterCount(tag) > CHARACTER_LIMITS.tag)) {
		errors.tags = `Each tag must be ${CHARACTER_LIMITS.tag} characters or fewer.`;
	}
	return errors;
}

export function characterDraftSignature(draft: CharacterDraft): string {
	return JSON.stringify(characterInputFromDraft(draft));
}

export function estimatePromptTokens(prompt: string): number {
	if (!prompt) return 0;
	return Math.ceil(new TextEncoder().encode(prompt).length / 4);
}

export function uniqueCopyName(
	name: string,
	characters: CharacterProfile[],
): string {
	const existing = new Set(
		characters.map((profile) => profile.name.trim().toLocaleLowerCase()),
	);
	const source = name.trim() || "Character";
	const candidate = (suffix: string) => {
		const available = CHARACTER_LIMITS.name - characterCount(suffix);
		const base = Array.from(source).slice(0, available).join("").trimEnd();
		return `${base}${suffix}`;
	};
	const root = candidate(" copy");
	if (!existing.has(root.toLocaleLowerCase())) return root;
	for (let index = 2; index < 10_000; index += 1) {
		const numbered = candidate(` copy ${index}`);
		if (!existing.has(numbered.toLocaleLowerCase())) return numbered;
	}
	return candidate(` copy ${Date.now()}`);
}
