import { apiFetch } from "./api";

export const DEFAULT_CHARACTER_ID = "default";

export interface CharacterSnapshot {
	name: string;
	avatar: string;
	description: string;
	system_prompt: string;
	opening_message: string;
	tags: string[];
}

export interface CharacterProfile extends CharacterSnapshot {
	id: string;
	default_provider: string;
	default_model: string;
	version: number;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
}

export interface CharacterProfileInput {
	name: string;
	avatar?: string;
	description?: string;
	system_prompt?: string;
	default_provider?: string;
	default_model?: string;
	opening_message?: string;
	tags?: string[];
}

export type CharacterProfileChanges = Partial<CharacterProfileInput>;

export interface CharacterListResponse {
	characters: CharacterProfile[];
	total: number;
}

export interface CharacterUpgradePreview {
	conversation_id: string;
	character_id: string;
	from_version: number;
	to_version: number;
	changed: boolean;
	changed_fields: Array<keyof CharacterSnapshot | "provider" | "model">;
	current_snapshot: CharacterSnapshot;
	proposed_snapshot: CharacterSnapshot;
	current_provider: string;
	proposed_provider: string;
	current_model: string;
	proposed_model: string;
}

export async function listCharacters(): Promise<CharacterListResponse> {
	return apiFetch<CharacterListResponse>("/characters");
}

export async function getCharacter(id: string): Promise<CharacterProfile> {
	return apiFetch<CharacterProfile>(`/characters/${encodeURIComponent(id)}`);
}

export async function createCharacter(
	profile: CharacterProfileInput,
): Promise<CharacterProfile> {
	return apiFetch<CharacterProfile>("/characters", {
		method: "POST",
		body: JSON.stringify(profile),
	});
}

export async function updateCharacter(
	id: string,
	expectedVersion: number,
	changes: CharacterProfileChanges,
): Promise<CharacterProfile> {
	return apiFetch<CharacterProfile>(`/characters/${encodeURIComponent(id)}`, {
		method: "PATCH",
		body: JSON.stringify({ expected_version: expectedVersion, ...changes }),
	});
}

export async function deleteCharacter(id: string): Promise<void> {
	await apiFetch<void>(`/characters/${encodeURIComponent(id)}`, {
		method: "DELETE",
	});
}

export async function previewCharacterUpgrade(
	conversationId: string,
): Promise<CharacterUpgradePreview> {
	return apiFetch<CharacterUpgradePreview>(
		`/conversations/${encodeURIComponent(conversationId)}/character-upgrade`,
	);
}

export async function upgradeConversationCharacter<TConversation>(
	conversationId: string,
	expectedCharacterVersion: number,
): Promise<TConversation> {
	return apiFetch<TConversation>(
		`/conversations/${encodeURIComponent(conversationId)}/character-upgrade`,
		{
			method: "POST",
			body: JSON.stringify({
				expected_character_version: expectedCharacterVersion,
			}),
		},
	);
}
