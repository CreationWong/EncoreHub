// State for the multi-AI group chat workspace app.
//
// The store owns the group conversation list, the active transcript, and the
// per-member streaming segments. It intentionally does not reuse
// conversationStore: that store models exactly one streaming assistant and
// would need invasive changes to represent several speakers at once.

import { create } from "zustand";
import {
	type Conversation,
	type ConversationParticipant,
	type GroupMemberSelection,
	type Message,
	type ReplyMode,
	createGroupConversation,
	deleteConversation as deleteConversationRequest,
	getConversation,
	listConversations,
	updateConversationReplyMode,
} from "../services/conversation";
import {
	type GroupParticipantStart,
	sendGroupMessageStream,
} from "../services/groupChat";
import { useSettingsStore } from "./settingsStore";
import { toast } from "./toastStore";

/** One member's live reply while the group turn is streaming. */
export interface GroupSegment {
	participantId: string;
	name: string;
	avatar: string;
	provider: string;
	model: string;
	position: number;
	content: string;
	reasoning: string;
	status: "streaming" | "done" | "skipped" | "error";
	error?: string;
}

/** A group is a conversation with an ordered roster of at least two members. */
export function isGroupConversation(conversation: Conversation): boolean {
	return (conversation.participants?.length ?? 0) > 1;
}

interface MultiChatState {
	conversations: Conversation[];
	listLoading: boolean;
	activeId: string | null;
	participants: ConversationParticipant[];
	replyMode: ReplyMode;
	messages: Message[];
	segments: GroupSegment[];
	streaming: boolean;
	loadingConversation: boolean;
	abortController: AbortController | null;
	loadConversations: () => Promise<void>;
	openConversation: (id: string) => Promise<void>;
	createGroup: (
		title: string,
		replyMode: ReplyMode,
		members: GroupMemberSelection[],
	) => Promise<string>;
	removeConversation: (id: string) => Promise<void>;
	setReplyMode: (replyMode: ReplyMode) => Promise<void>;
	sendMessage: (content: string, mentions: string[]) => Promise<void>;
	stopStreaming: () => void;
	/** Close the active conversation and drop its transcript. */
	closeConversation: () => void;
}

function upsertSegment(
	segments: GroupSegment[],
	start: GroupParticipantStart,
): GroupSegment[] {
	const index = segments.findIndex(
		(segment) => segment.participantId === start.participant_id,
	);
	const next: GroupSegment = {
		participantId: start.participant_id,
		name: start.name,
		avatar: start.avatar,
		provider: start.provider,
		model: start.model,
		position: start.position,
		content: "",
		reasoning: "",
		status: "streaming",
	};
	if (index < 0) return [...segments, next];
	return segments.map((segment, position) =>
		position === index
			? { ...segment, ...next, content: segment.content }
			: segment,
	);
}

function updateSegment(
	segments: GroupSegment[],
	participantId: string,
	update: (segment: GroupSegment) => GroupSegment,
): GroupSegment[] {
	return segments.map((segment) =>
		segment.participantId === participantId ? update(segment) : segment,
	);
}

export const useMultiChatStore = create<MultiChatState>((set, get) => ({
	conversations: [],
	listLoading: false,
	activeId: null,
	participants: [],
	replyMode: "sequential",
	messages: [],
	segments: [],
	streaming: false,
	loadingConversation: false,
	abortController: null,

	loadConversations: async () => {
		set({ listLoading: true });
		try {
			const response = await listConversations();
			const groups = response.conversations.filter(isGroupConversation);
			set({ conversations: groups, listLoading: false });
		} catch (error) {
			set({ listLoading: false });
			toast.error(
				error instanceof Error ? error.message : "Failed to load groups",
			);
		}
	},

	openConversation: async (id) => {
		if (get().streaming) get().stopStreaming();
		set({ loadingConversation: true, activeId: id, segments: [] });
		try {
			const detail = await getConversation(id);
			set({
				activeId: id,
				participants: detail.participants ?? [],
				replyMode: detail.reply_mode ?? "sequential",
				messages: detail.messages,
				segments: [],
				loadingConversation: false,
			});
		} catch (error) {
			set({ loadingConversation: false });
			toast.error(
				error instanceof Error ? error.message : "Failed to open group",
			);
		}
	},

	createGroup: async (title, replyMode, members) => {
		const created = await createGroupConversation(title, replyMode, members);
		await get().loadConversations();
		await get().openConversation(created.id);
		return created.id;
	},

	removeConversation: async (id) => {
		await deleteConversationRequest(id);
		set((state) => ({
			conversations: state.conversations.filter((item) => item.id !== id),
			...(state.activeId === id
				? {
						activeId: null,
						participants: [],
						messages: [],
						segments: [],
					}
				: {}),
		}));
	},

	setReplyMode: async (replyMode) => {
		const activeId = get().activeId;
		if (!activeId) return;
		const previous = get().replyMode;
		set({ replyMode });
		try {
			await updateConversationReplyMode(activeId, replyMode);
		} catch (error) {
			// Roll back so the selector never claims a mode the Engine refused.
			set({ replyMode: previous });
			toast.error(
				error instanceof Error ? error.message : "Failed to update reply mode",
			);
		}
	},

	sendMessage: async (content, mentions) => {
		const { activeId, streaming } = get();
		if (!activeId || streaming) return;
		const trimmed = content.trim();
		if (!trimmed) return;

		const optimisticUser: Message = {
			id: `local-user-${Date.now()}`,
			role: "user",
			content: trimmed,
			parent_id: null,
			tool_calls: [],
			status: "completed",
			created_at: new Date().toISOString(),
		};
		set((state) => ({
			messages: [...state.messages, optimisticUser],
			segments: [],
			streaming: true,
		}));

		const controller = new AbortController();
		set({ abortController: controller });

		// Session keys are sent as X-<Provider>-Key per member; the Gateway
		// falls back to the Engine vault when a header is absent.
		const apiKeys = useSettingsStore.getState().apiKeys;
		const providerKeys: Record<string, string> = {};
		for (const participant of get().participants) {
			const key = apiKeys[participant.provider];
			if (key) providerKeys[participant.provider] = key;
		}

		const reload = async () => {
			try {
				const detail = await getConversation(activeId);
				set({
					participants: detail.participants ?? get().participants,
					replyMode: detail.reply_mode ?? get().replyMode,
					messages: detail.messages,
					segments: [],
				});
			} catch {
				/* the transcript stays as streamed if reload fails */
			}
		};

		await sendGroupMessageStream(
			activeId,
			trimmed,
			providerKeys,
			mentions,
			{
				onTurnStarted: (userMessage) => {
					set((state) => ({
						messages: state.messages.map((message) =>
							message.id === optimisticUser.id ? userMessage : message,
						),
					}));
				},
				onParticipantStarted: (participant) => {
					set((state) => ({
						segments: upsertSegment(state.segments, participant),
					}));
				},
				onDelta: (participantId, delta) => {
					set((state) => ({
						segments: updateSegment(
							state.segments,
							participantId,
							(segment) => ({
								...segment,
								content: segment.content + delta,
							}),
						),
					}));
				},
				onReasoning: (participantId, reasoning) => {
					set((state) => ({
						segments: updateSegment(
							state.segments,
							participantId,
							(segment) => ({
								...segment,
								reasoning: segment.reasoning + reasoning,
							}),
						),
					}));
				},
				onParticipantDone: (participantId) => {
					set((state) => ({
						segments: updateSegment(
							state.segments,
							participantId,
							(segment) => ({
								...segment,
								status: "done",
							}),
						),
					}));
				},
				onParticipantSkipped: (participantId) => {
					set((state) => ({
						segments: updateSegment(
							state.segments,
							participantId,
							(segment) => ({
								...segment,
								status: "skipped",
								content: "",
							}),
						),
					}));
				},
				onParticipantError: (participantId, message) => {
					set((state) => ({
						segments: updateSegment(
							state.segments,
							participantId,
							(segment) => ({
								...segment,
								status: "error",
								error: message,
							}),
						),
					}));
				},
				onDone: async () => {
					await reload();
					await get().loadConversations();
				},
				onError: async (error) => {
					if (error.user_message || error.assistant_messages?.length) {
						await reload();
					}
					toast.error(error.message);
				},
			},
			controller.signal,
		);

		set({ streaming: false, abortController: null });
	},

	stopStreaming: () => {
		get().abortController?.abort();
		set({ streaming: false, abortController: null, segments: [] });
		const activeId = get().activeId;
		if (activeId) {
			// The Gateway finalizes the turn asynchronously after the client
			// disconnects; reload shortly after so any committed partials show.
			setTimeout(() => {
				void get().openConversation(activeId);
			}, 600);
		}
	},

	closeConversation: () => {
		if (get().streaming) get().stopStreaming();
		set({
			activeId: null,
			participants: [],
			messages: [],
			segments: [],
		});
	},
}));
