// Typed Gateway client contracts for memory records, groups, and role policies.

import { apiFetch } from "./api";

export interface Memory {
	id: string;
	scope: string;
	memory_type: string;
	conversation_id: string | null;
	group_id: string;
	source_character_id: string | null;
	state: MemoryState;
	kind: MemoryKind;
	canonical_key: string | null;
	reason: string;
	source_turn_id: string | null;
	created_by_model: string;
	confidence: number;
	content: string;
	importance: number;
	created_at: string;
	last_accessed_at: string;
}

export type MemoryState =
	| "transient"
	| "short_term"
	| "long_term"
	| "permanent_candidate"
	| "permanent"
	| "forgotten";

export type MemoryKind =
	| "fact"
	| "preference"
	| "event"
	| "instruction"
	| "summary";

export type MemoryMode = "simple" | "rag" | "rag_enhanced" | "realistic";

export interface MemoryGroup {
	id: string;
	profile_id: string;
	name: string;
	group_type: "character" | "global" | "custom";
	owner_character_id: string | null;
	archived_at: string | null;
	created_at: string;
	updated_at: string;
}

export interface MemoryGroupInheritance {
	character_id: string;
	group_id: string;
	access_mode: "read" | "read_write";
	priority: number;
}

export interface CharacterMemorySettingsResponse {
	settings: {
		character_id: string;
		default_mode: MemoryMode;
		realistic_enabled: boolean;
		updated_at: string;
	};
	inherited_groups: MemoryGroupInheritance[];
	visible_group_ids: string[];
}

export interface MemoryListOptions {
	scope?: string;
	group_id?: string;
	character_id?: string;
}

interface MemoryListResponse {
	memories: Memory[];
	total: number;
}

interface MemorySearchResponse {
	results: Memory[];
	query: string;
}

export interface MemorySearchOptions {
	q: string;
	scope?: string;
	group_id?: string;
	character_id?: string;
	top_k?: number;
}

export const memoriesApi = {
	list(options?: string | MemoryListOptions): Promise<MemoryListResponse> {
		const normalized =
			typeof options === "string" ? { scope: options } : (options ?? {});
		const params = new URLSearchParams();
		if (normalized.scope) params.set("scope", normalized.scope);
		if (normalized.group_id) params.set("group_id", normalized.group_id);
		if (normalized.character_id)
			params.set("character_id", normalized.character_id);
		const query = params.toString();
		return apiFetch<MemoryListResponse>(
			query ? `/memories?${query}` : "/memories",
		);
	},

	search(opts: MemorySearchOptions): Promise<MemorySearchResponse> {
		const params = new URLSearchParams({ q: opts.q });
		if (opts.scope) params.set("scope", opts.scope);
		if (opts.group_id) params.set("group_id", opts.group_id);
		if (opts.character_id) params.set("character_id", opts.character_id);
		if (opts.top_k) params.set("top_k", String(opts.top_k));
		return apiFetch<MemorySearchResponse>(`/memories/search?${params}`);
	},

	delete(id: string): Promise<void> {
		return apiFetch<void>(`/memories/${id}`, { method: "DELETE" });
	},

	listGroups(): Promise<{ groups: MemoryGroup[]; total: number }> {
		return apiFetch<{ groups: MemoryGroup[]; total: number }>("/memory-groups");
	},

	createGroup(name: string): Promise<MemoryGroup> {
		return apiFetch<MemoryGroup>("/memory-groups", {
			method: "POST",
			body: JSON.stringify({ name }),
		});
	},

	updateGroup(
		id: string,
		input: { name?: string; archived?: boolean },
	): Promise<MemoryGroup> {
		return apiFetch<MemoryGroup>(`/memory-groups/${encodeURIComponent(id)}`, {
			method: "PATCH",
			body: JSON.stringify(input),
		});
	},

	deleteGroup(
		id: string,
		input: {
			strategy: "transfer" | "delete_memories";
			target_group_id?: string;
		},
	): Promise<void> {
		const params = new URLSearchParams({ strategy: input.strategy });
		if (input.target_group_id)
			params.set("target_group_id", input.target_group_id);
		return apiFetch<void>(
			`/memory-groups/${encodeURIComponent(id)}?${params.toString()}`,
			{ method: "DELETE" },
		);
	},

	getCharacterSettings(id: string): Promise<CharacterMemorySettingsResponse> {
		return apiFetch<CharacterMemorySettingsResponse>(
			`/characters/${encodeURIComponent(id)}/memory-settings`,
		);
	},

	updateCharacterSettings(
		id: string,
		input: {
			default_mode: MemoryMode;
			realistic_enabled: boolean;
			inherited_groups: MemoryGroupInheritance[];
		},
	): Promise<CharacterMemorySettingsResponse> {
		return apiFetch<CharacterMemorySettingsResponse>(
			`/characters/${encodeURIComponent(id)}/memory-settings`,
			{ method: "PUT", body: JSON.stringify(input) },
		);
	},
};
