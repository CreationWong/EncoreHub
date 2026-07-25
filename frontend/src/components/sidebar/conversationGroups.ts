import type { Conversation } from "../../services/conversation";

export type ConversationGroupId = "today" | "yesterday" | "week" | "older";

export interface ConversationGroup {
	id: ConversationGroupId;
	label: string;
	conversations: Conversation[];
}

const GROUPS: { id: ConversationGroupId; label: string }[] = [
	{ id: "today", label: "Today" },
	{ id: "yesterday", label: "Yesterday" },
	{ id: "week", label: "Previous 7 days" },
	{ id: "older", label: "Older" },
];

const DAY_MS = 24 * 60 * 60 * 1000;

function localDayOrdinal(date: Date): number {
	return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
}

function updatedTimestamp(conversation: Conversation): number {
	const timestamp = Date.parse(conversation.updated_at);
	return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

export function groupConversations(
	conversations: Conversation[],
	now = new Date(),
): ConversationGroup[] {
	const buckets = new Map<ConversationGroupId, Conversation[]>();
	for (const group of GROUPS) buckets.set(group.id, []);
	const today = localDayOrdinal(now);

	for (const conversation of [...conversations].sort(
		(left, right) => updatedTimestamp(right) - updatedTimestamp(left),
	)) {
		const updated = new Date(conversation.updated_at);
		const difference = Number.isNaN(updated.getTime())
			? Number.POSITIVE_INFINITY
			: today - localDayOrdinal(updated);
		const group: ConversationGroupId =
			difference <= 0
				? "today"
				: difference === 1
					? "yesterday"
					: difference <= 7
						? "week"
						: "older";
		buckets.get(group)?.push(conversation);
	}

	return GROUPS.map((group) => ({
		...group,
		conversations: buckets.get(group.id) ?? [],
	})).filter((group) => group.conversations.length > 0);
}
