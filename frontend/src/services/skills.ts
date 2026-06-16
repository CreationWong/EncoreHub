import { apiFetch } from "./api";

export interface Skill {
	id: string;
	name: string;
	description: string;
	version: string;
	author: string;
	enabled: boolean;
	builtin: boolean;
	triggers: string[];
	tool_count: number;
}

interface SkillListResponse {
	skills: Skill[];
}

export const skillsApi = {
	list(): Promise<SkillListResponse> {
		return apiFetch<SkillListResponse>("/skills");
	},

	match(query: string): Promise<SkillListResponse> {
		const q = encodeURIComponent(query);
		return apiFetch<SkillListResponse>(`/skills/match?q=${q}`);
	},

	toggle(id: string, enabled: boolean): Promise<void> {
		return apiFetch<void>(`/skills/${id}/toggle`, {
			method: "POST",
			body: JSON.stringify({ enabled }),
		});
	},
};
