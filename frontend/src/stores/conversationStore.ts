import { create } from "zustand";
import { type StreamToolCall, chatApi } from "../services/chat";
import type {
	Conversation,
	ConversationDetail,
	Message,
	ToolCall,
} from "../services/conversation";
import * as convApi from "../services/conversation";
import { useSettingsStore } from "./settingsStore";
import { toast } from "./toastStore";

interface ConversationState {
	conversations: Conversation[];
	activeId: string | null;
	messages: Message[];
	loading: boolean;
	streaming: boolean;
	streamingContent: string;
	streamingReasoning: string;
	streamingToolCalls: StreamToolCall[];
	error: string | null;
	abortController: AbortController | null;
	pendingDraft: string | null;

	loadList: () => Promise<void>;
	selectConversation: (id: string) => Promise<void>;
	newConversation: () => Promise<string>;
	deleteConversation: (id: string) => Promise<void>;
	renameConversation: (id: string, title: string) => Promise<void>;
	sendMessage: (content: string) => Promise<void>;
	stopStreaming: () => void;
	pushSystemMessage: (content: string) => void;
	setDraft: (content: string) => void;
	clearDraft: () => void;
	clearError: () => void;
}

export const useConversationStore = create<ConversationState>((set, get) => ({
	conversations: [],
	activeId: null,
	messages: [],
	loading: false,
	streaming: false,
	streamingContent: "",
	streamingReasoning: "",
	streamingToolCalls: [],
	error: null,
	abortController: null,
	pendingDraft: null,

	loadList: async () => {
		try {
			const resp = await convApi.listConversations();
			set({ conversations: resp.conversations });
		} catch (err) {
			console.error("Failed to load conversations:", err);
		}
	},

	selectConversation: async (id: string) => {
		set({
			activeId: id,
			loading: true,
			streaming: false,
			streamingContent: "",
			streamingReasoning: "",
			streamingToolCalls: [],
			error: null,
		});
		try {
			const detail = await convApi.getConversation(id);
			set({ messages: detail.messages, loading: false });
		} catch (err) {
			console.error("Failed to load conversation:", err);
			set({ loading: false, error: "Failed to load conversation" });
			toast.error("Failed to load conversation");
		}
	},

	newConversation: async () => {
		try {
			const { provider, model } = useSettingsStore.getState();
			const conv = await convApi.createConversation(
				"New Chat",
				provider || "",
				model || "",
			);
			await get().loadList();
			set({
				activeId: conv.id,
				messages: [],
				streamingContent: "",
				error: null,
			});
			return conv.id;
		} catch (err) {
			console.error("Failed to create conversation:", err);
			set({ error: "Failed to create conversation" });
			toast.error("Failed to create conversation");
			return "";
		}
	},

	deleteConversation: async (id: string) => {
		try {
			await convApi.deleteConversation(id);
			const { activeId } = get();
			if (activeId === id) {
				set({ activeId: null, messages: [], streamingContent: "" });
			}
			await get().loadList();
		} catch (err) {
			console.error("Failed to delete conversation:", err);
			set({ error: "Failed to delete conversation" });
			toast.error("Failed to delete conversation");
		}
	},

	renameConversation: async (id: string, title: string) => {
		const trimmed = title.trim();
		if (!trimmed) return;
		// Optimistic local rename — undo on server failure.
		const prev = get().conversations.find((c) => c.id === id)?.title;
		set((s) => ({
			conversations: s.conversations.map((c) =>
				c.id === id ? { ...c, title: trimmed } : c,
			),
		}));
		try {
			await convApi.renameConversation(id, trimmed);
		} catch (err) {
			console.error("rename failed:", err);
			set((s) => ({
				conversations: s.conversations.map((c) =>
					c.id === id && prev !== undefined ? { ...c, title: prev } : c,
				),
				error: "Rename failed",
			}));
			toast.error("Rename failed");
		}
	},

	sendMessage: async (content: string) => {
		const { activeId, messages } = get();
		let convId = activeId;

		if (!convId) {
			convId = await get().newConversation();
			if (!convId) return;
		}

		// Get API key + search settings
		const { provider, apiKeys, searchEnabled, searchProvider } = useSettingsStore.getState();
		const providerKey = provider ? apiKeys[provider] : undefined;

		// Optimistic user message
		const userMsg: Message = {
			id: `user-${Date.now()}`,
			role: "user",
			content,
			parent_id: null,
			tool_calls: [],
			created_at: new Date().toISOString(),
		};

		const controller = new AbortController();
		set({
			messages: [...messages, userMsg],
			streaming: true,
			streamingContent: "",
			streamingReasoning: "",
			streamingToolCalls: [],
			error: null,
			abortController: controller,
		});

		let streamTokenCount = 0;

		const finalize = (final: string) => {
			const { streamingReasoning, streamingToolCalls } = get();
			const toolCalls: ToolCall[] = streamingToolCalls
				.filter((tc) => tc.name)
				.map((tc) => ({
					id: tc.id ?? `tc-${tc.index}`,
					name: tc.name,
					arguments: tc.arguments,
					result: tc.result,
					status: tc.status ?? "pending",
				}));
			set((s) => ({
				messages: [
					...s.messages.filter((m) => m.id !== userMsg.id),
					userMsg,
					{
						id: `asst-${Date.now()}`,
						role: "assistant",
						content: final,
						reasoning: streamingReasoning || undefined,
						parent_id: userMsg.id,
						tool_calls: toolCalls,
						token_count: streamTokenCount || undefined,
						created_at: new Date().toISOString(),
					},
				],
				streaming: false,
				streamingContent: "",
				streamingReasoning: "",
				streamingToolCalls: [],
				abortController: null,
			}));
			get().loadList();
		};

		await chatApi.sendMessageStream(
			convId,
			content,
			providerKey,
			{
				onDelta(delta) {
					set((s) => ({ streamingContent: s.streamingContent + delta }));
				},
				onReasoning(chunk) {
					set((s) => ({ streamingReasoning: s.streamingReasoning + chunk }));
				},
				onToolCall(call) {
					set((s) => {
						const calls = [...s.streamingToolCalls];
						const existing = calls.find((c) => c.index === call.index);
						if (existing) {
							if (call.id) existing.id = call.id;
							if (call.name) existing.name = call.name;
							if (call.arguments) existing.arguments += call.arguments;
						} else {
							calls.push({
								index: call.index,
								id: call.id,
								name: call.name ?? "",
								arguments: call.arguments ?? "",
								status: "pending",
							});
						}
						return { streamingToolCalls: calls };
					});
				},
				onToolResult(res) {
					set((s) => ({
						streamingToolCalls: s.streamingToolCalls.map((c) =>
							c.id === res.id || (!c.id && c.status === "pending")
								? {
										...c,
										result: res.result,
										status: res.status as StreamToolCall["status"],
									}
								: c,
						),
					}));
				},
				onUsage(input, output) {
					streamTokenCount = input + output;
				},
				onWarning(msg) {
					toast.warning(msg, 6000);
				},
				onDone(fullContent) {
					finalize(fullContent || "(empty response)");
				},
				onError(errorMsg) {
					console.error("Stream error:", errorMsg);
					set((s) => ({
						messages: s.messages.filter((m) => m.id !== userMsg.id),
						streaming: false,
						streamingContent: "",
						streamingReasoning: "",
						streamingToolCalls: [],
						error: errorMsg,
						abortController: null,
					}));
					toast.error(errorMsg);
				},
			},
			controller.signal,
			searchEnabled,
			searchProvider,
		);

		// If aborted mid-stream, finalize with what we have so the user keeps the
		// partial answer instead of losing it.
		if (controller.signal.aborted) {
			const partial = get().streamingContent;
			if (partial) finalize(`${partial}\n\n_(stopped)_`);
			else
				set({
					messages: get().messages.filter((m) => m.id !== userMsg.id),
					streaming: false,
					streamingContent: "",
					streamingReasoning: "",
					streamingToolCalls: [],
					abortController: null,
				});
		}
	},

	stopStreaming: () => {
		const { abortController } = get();
		if (abortController) abortController.abort();
	},

	pushSystemMessage: (content: string) => {
		set((s) => ({
			messages: [
				...s.messages,
				{
					id: `sys-${Date.now()}`,
					role: "system",
					content,
					parent_id: null,
					tool_calls: [],
					created_at: new Date().toISOString(),
				},
			],
		}));
	},

	setDraft: (content: string) => set({ pendingDraft: content }),
	clearDraft: () => set({ pendingDraft: null }),

	clearError: () => set({ error: null }),
}));
