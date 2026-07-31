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
	revision: number;
	active_branch: string;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
}

export interface CharacterVersion extends CharacterSnapshot {
	character_id: string;
	version: number;
	parent_version: number | null;
	branch_name: string;
	message: string;
	default_provider: string;
	default_model: string;
	created_at: string;
}

export interface CharacterBranch {
	character_id: string;
	name: string;
	head_version: number;
	created_from_version: number;
	created_at: string;
	updated_at: string;
}

export interface CharacterHistory {
	character: CharacterProfile;
	branches: CharacterBranch[];
	versions: CharacterVersion[];
}

export interface CharacterHistoryListResponse {
	histories: CharacterHistory[];
	total: number;
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
	expectedRevision: number,
	changes: CharacterProfileChanges,
): Promise<CharacterProfile> {
	return apiFetch<CharacterProfile>(`/characters/${encodeURIComponent(id)}`, {
		method: "PATCH",
		body: JSON.stringify({ expected_revision: expectedRevision, ...changes }),
	});
}

export async function listCharacterHistories(): Promise<CharacterHistoryListResponse> {
	return apiFetch<CharacterHistoryListResponse>("/characters/history");
}

export async function commitCharacterVersion(
	id: string,
	expectedRevision: number,
	message: string,
): Promise<CharacterProfile> {
	return apiFetch<CharacterProfile>(
		`/characters/${encodeURIComponent(id)}/versions`,
		{
			method: "POST",
			body: JSON.stringify({ expected_revision: expectedRevision, message }),
		},
	);
}

export async function createCharacterBranch(
	id: string,
	expectedRevision: number,
	name: string,
	fromVersion: number,
): Promise<CharacterProfile> {
	return apiFetch<CharacterProfile>(
		`/characters/${encodeURIComponent(id)}/branches`,
		{
			method: "POST",
			body: JSON.stringify({
				expected_revision: expectedRevision,
				name,
				from_version: fromVersion,
			}),
		},
	);
}

export async function restoreCharacterVersion(
	id: string,
	expectedRevision: number,
	version: number,
): Promise<CharacterProfile> {
	return apiFetch<CharacterProfile>(
		`/characters/${encodeURIComponent(id)}/versions/${version}/restore`,
		{
			method: "POST",
			body: JSON.stringify({ expected_revision: expectedRevision }),
		},
	);
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
