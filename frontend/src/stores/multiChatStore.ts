// State for the multi-AI group chat workspace app.
//
// The Gateway now schedules group turns asynchronously: sending only enqueues a
// user message, and a background runner streams its work over the group events
// SSE endpoint. This store therefore owns a live subscription instead of a
// request-scoped stream, and renders committed messages plus per-member
// generation segments.

import { create } from "zustand";
import {
	type Conversation,
	type ConversationParticipant,
	type GroupChatSettings,
	type GroupMemberSelection,
	type Message,
	type ReplyMode,
	createGroupConversation,
	deleteConversation as deleteConversationRequest,
	getConversation,
	listConversations,
	updateConversationGroupSettings,
	updateConversationReplyMode,
} from "../services/conversation";
import {
	type GroupParticipantStart,
	enqueueGroupMessage,
	subscribeGroupEvents,
} from "../services/groupChat";
import { toast } from "./toastStore";

/** One member's live reply while the runner generates it. */
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

/** Runner lifecycle reported by the Gateway. */
export type GroupRunnerState = "idle" | "running" | "paused";

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
	groupSettings: GroupChatSettings | null;
	messages: Message[];
	segments: GroupSegment[];
	runnerState: GroupRunnerState;
	pending: number;
	eventsController: AbortController | null;
	loadConversations: () => Promise<void>;
	openConversation: (id: string) => Promise<void>;
	createGroup: (
		title: string,
		replyMode: ReplyMode,
		members: GroupMemberSelection[],
		groupSettings?: GroupChatSettings,
	) => Promise<string>;
	removeConversation: (id: string) => Promise<void>;
	setReplyMode: (replyMode: ReplyMode) => Promise<void>;
	saveGroupSettings: (settings: GroupChatSettings) => Promise<void>;
	subscribe: (id: string) => void;
	sendMessage: (content: string, mentions: string[]) => Promise<void>;
	stopStreaming: () => Promise<void>;
	closeConversation: () => void;
}

function upsertById(messages: Message[], message: Message): Message[] {
	const index = messages.findIndex((item) => item.id === message.id);
	if (index < 0) return [...messages, message];
	return messages.map((item, position) =>
		position === index ? message : item,
	);
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
	groupSettings: null,
	messages: [],
	segments: [],
	runnerState: "idle",
	pending: 0,
	eventsController: null,

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
		get().eventsController?.abort();
		set({ activeId: id, segments: [], eventsController: null });
		try {
			const detail = await getConversation(id);
			set({
				activeId: id,
				participants: detail.participants ?? [],
				replyMode: detail.reply_mode ?? "sequential",
				groupSettings: detail.group_settings ?? null,
				messages: detail.messages,
				segments: [],
			});
			get().subscribe(id);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to open group",
			);
		}
	},

	createGroup: async (title, replyMode, members, groupSettings) => {
		const created = await createGroupConversation(title, replyMode, members);
		if (groupSettings) {
			await updateConversationGroupSettings(created.id, groupSettings);
		}
		await get().loadConversations();
		await get().openConversation(created.id);
		return created.id;
	},

	removeConversation: async (id) => {
		if (get().activeId === id) get().closeConversation();
		await deleteConversationRequest(id);
		set((state) => ({
			conversations: state.conversations.filter((item) => item.id !== id),
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

	saveGroupSettings: async (settings) => {
		const activeId = get().activeId;
		if (!activeId) return;
		const previous = get().groupSettings;
		set({ groupSettings: settings });
		try {
			const updated = await updateConversationGroupSettings(activeId, settings);
			set({ groupSettings: updated.group_settings ?? settings });
		} catch (error) {
			set({ groupSettings: previous });
			toast.error(
				error instanceof Error
					? error.message
					: "Failed to save group settings",
			);
			// Rethrow so callers never report success for a rejected save.
			throw error;
		}
	},

	/**
	 * Subscribe to the conversation's runner events.
	 *
	 * A dropped stream (app or Gateway restart) reconnects on a short delay so
	 * a reopened group keeps showing live discussion without user action.
	 */
	subscribe: (id) => {
		get().eventsController?.abort();
		const controller = new AbortController();
		set({ eventsController: controller });

		const connect = async () => {
			if (controller.signal.aborted) return;
			await subscribeGroupEvents(
				id,
				{
					onRunnerState: (state) => {
						set({
							runnerState: state.state,
							pending: state.pending,
							...(state.state === "idle" ? { segments: [] } : {}),
						});
					},
					onQueueUpdated: (pending) => set({ pending }),
					onMessageAppended: (message) => {
						set((state) => ({
							messages: upsertById(state.messages, message),
							segments: message.sender_character_id
								? state.segments.filter(
										(segment) =>
											segment.participantId !== message.sender_character_id,
									)
								: state.segments,
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
								(segment) => ({ ...segment, status: "done" }),
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
					onError: (message) => {
						toast.error(message);
					},
				},
				controller.signal,
			);
			if (!controller.signal.aborted) {
				setTimeout(() => {
					if (!controller.signal.aborted && get().activeId === id) {
						void connect();
					}
				}, 2000);
			}
		};
		void connect();
	},

	sendMessage: async (content, mentions) => {
		const activeId = get().activeId;
		if (!activeId) return;
		const trimmed = content.trim();
		if (!trimmed) return;
		try {
			const result = await enqueueGroupMessage(activeId, trimmed, mentions);
			if (result.command) {
				// Commands are acknowledged by the runner state event; the
				// system note arrives through message_appended.
				return;
			}
			if (result.user_message) {
				set((state) => ({
					messages: upsertById(state.messages, result.user_message as Message),
					pending: result.queued ?? state.pending,
					runnerState: "running",
				}));
			}
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to send message",
			);
		}
	},

	stopStreaming: async () => {
		const activeId = get().activeId;
		if (!activeId) return;
		try {
			await enqueueGroupMessage(activeId, "/stop", []);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to stop the group",
			);
		}
	},

	closeConversation: () => {
		get().eventsController?.abort();
		set({
			activeId: null,
			participants: [],
			groupSettings: null,
			messages: [],
			segments: [],
			runnerState: "idle",
			pending: 0,
			eventsController: null,
		});
	},
}));
