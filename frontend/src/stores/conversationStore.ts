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

// ---- per-conversation cache (supports concurrent background streams) ----

interface ConvCacheEntry {
	messages: Message[];
	streaming: boolean;
	streamingContent: string;
	streamingReasoning: string;
	streamingToolCalls: StreamToolCall[];
	abortController: AbortController | null;
}

function emptyCacheEntry(messages: Message[] = []): ConvCacheEntry {
	return {
		messages,
		streaming: false,
		streamingContent: "",
		streamingReasoning: "",
		streamingToolCalls: [],
		abortController: null,
	};
}

function currentViewEntry(s: ConversationState): ConvCacheEntry {
	return {
		messages: s.messages,
		streaming: s.streaming,
		streamingContent: s.streamingContent,
		streamingReasoning: s.streamingReasoning,
		streamingToolCalls: s.streamingToolCalls,
		abortController: s.abortController,
	};
}

function saveActiveViewToCache(
	s: ConversationState,
): Record<string, ConvCacheEntry> {
	if (!s.activeId || !s.convCache[s.activeId]) return s.convCache;
	return {
		...s.convCache,
		[s.activeId]: currentViewEntry(s),
	};
}

function logStoreError(operation: string, error: unknown): void {
	let errorType: string = typeof error;
	let errorLength = 0;
	if (error instanceof Error) {
		errorType = error.name || "Error";
		errorLength = error.message.length;
	} else if (typeof error === "string") {
		errorLength = error.length;
	}
	console.error(operation, {
		error_type: errorType,
		error_length: errorLength,
	});
}

/**
 * Build the partial state needed to apply an update to a conversation's cache
 * entry. When the conversation is the active one the same fields are mirrored
 * onto the top-level view so existing UI selectors keep working unchanged.
 */
function cacheUpdate(
	s: ConversationState,
	convId: string,
	patch: Partial<ConvCacheEntry>,
): Partial<ConversationState> {
	const prev = s.convCache[convId];
	if (!prev) return {};
	const updated = { ...prev, ...patch };
	const newCache = { ...s.convCache, [convId]: updated };

	if (s.activeId !== convId) return { convCache: newCache };

	// Mirror every patched field to the top-level view.
	const view: Record<string, unknown> = { convCache: newCache };
	for (const key of Object.keys(patch) as (keyof ConvCacheEntry)[]) {
		view[key] = updated[key];
	}
	return view as Partial<ConversationState>;
}

// ---- store ----

interface ConversationState {
	conversations: Conversation[];
	activeId: string | null;

	// Top-level view fields — always mirror the active conversation's cache entry.
	messages: Message[];
	loading: boolean;
	streaming: boolean;
	streamingContent: string;
	streamingReasoning: string;
	streamingToolCalls: StreamToolCall[];
	error: string | null;
	abortController: AbortController | null;
	pendingDraft: string | null;

	// Per-conversation state pool.
	convCache: Record<string, ConvCacheEntry>;

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
	generateTitle: (id: string, force?: boolean) => Promise<void>;
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
	convCache: {},

	loadList: async () => {
		try {
			const resp = await convApi.listConversations();
			set({ conversations: resp.conversations });
		} catch (err) {
			logStoreError("Failed to load conversations", err);
		}
	},

	selectConversation: async (id: string) => {
		const convCache = saveActiveViewToCache(get());

		// Restore from cache if available.
		const cached = convCache[id];
		if (cached) {
			set({
				activeId: id,
				messages: cached.messages,
				streaming: cached.streaming,
				streamingContent: cached.streamingContent,
				streamingReasoning: cached.streamingReasoning,
				streamingToolCalls: cached.streamingToolCalls,
				abortController: cached.abortController,
				loading: false,
				error: null,
				convCache,
			});
			return;
		}

		// First time opening this conversation — fetch from server.
		set({
			activeId: id,
			loading: true,
			streaming: false,
			streamingContent: "",
			streamingReasoning: "",
			streamingToolCalls: [],
			error: null,
			convCache,
		});
		try {
			const detail = await convApi.getConversation(id);
			const entry = emptyCacheEntry(detail.messages);
			set((s) => {
				const nextCache = { ...s.convCache, [id]: entry };
				if (s.activeId !== id) {
					return { convCache: nextCache };
				}
				return {
					messages: detail.messages,
					loading: false,
					convCache: nextCache,
				};
			});
		} catch (err) {
			logStoreError("Failed to load conversation", err);
			set((s) =>
				s.activeId === id
					? { loading: false, error: "Failed to load conversation" }
					: {},
			);
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
			const entry = emptyCacheEntry([]);
			set((s) => ({
				activeId: conv.id,
				messages: [],
				loading: false,
				streaming: false,
				streamingContent: "",
				streamingReasoning: "",
				streamingToolCalls: [],
				abortController: null,
				error: null,
				convCache: { ...saveActiveViewToCache(s), [conv.id]: entry },
			}));
			return conv.id;
		} catch (err) {
			logStoreError("Failed to create conversation", err);
			set({ error: "Failed to create conversation" });
			toast.error("Failed to create conversation");
			return "";
		}
	},

	deleteConversation: async (id: string) => {
		try {
			await convApi.deleteConversation(id);
			const { activeId, convCache } = get();
			const newCache = { ...convCache };
			delete newCache[id];
			if (activeId === id) {
				set({
					activeId: null,
					messages: [],
					loading: false,
					streaming: false,
					streamingContent: "",
					streamingReasoning: "",
					streamingToolCalls: [],
					abortController: null,
					convCache: newCache,
				});
			} else {
				set({ convCache: newCache });
			}
			await get().loadList();
		} catch (err) {
			logStoreError("Failed to delete conversation", err);
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
			logStoreError("Rename failed", err);
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

		// Ensure a cache entry exists for this conversation.
		if (!get().convCache[convId]) {
			set({
				convCache: {
					...get().convCache,
					[convId]: emptyCacheEntry(get().messages),
				},
			});
		}

		// Get API key + search settings
		const { provider, apiKeys, searchEnabled, searchProvider } =
			useSettingsStore.getState();
		const convProvider =
			get().conversations.find((c) => c.id === convId)?.provider || provider;
		const providerKey = convProvider ? apiKeys[convProvider] : undefined;

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

		// Write optimistic user message to BOTH the view (if active) and cache.
		set((s) => {
			const patch = cacheUpdate(s, convId, {
				messages: [...(s.convCache[convId]?.messages ?? messages), userMsg],
				streaming: true,
				streamingContent: "",
				streamingReasoning: "",
				streamingToolCalls: [],
				abortController: controller,
			});
			return {
				...patch,
				error: null,
			} as Partial<ConversationState>;
		});

		let streamTokenCount = 0;

		const finalize = (final: string) => {
			set((s) => {
				const entry = s.convCache[convId];
				if (!entry) return {};
				const { streamingReasoning: reasoning, streamingToolCalls: toolCalls } =
					entry;
				const mapped: ToolCall[] = toolCalls
					.filter((tc) => tc.name)
					.map((tc) => ({
						id: tc.id ?? `tc-${tc.index}`,
						name: tc.name,
						arguments: tc.arguments,
						result: tc.result,
						status: tc.status ?? "pending",
					}));

				const assistantMsg: Message = {
					id: `asst-${Date.now()}`,
					role: "assistant",
					content: final,
					reasoning: reasoning || undefined,
					parent_id: userMsg.id,
					tool_calls: mapped,
					token_count: streamTokenCount || undefined,
					created_at: new Date().toISOString(),
				};

				const updatedMessages = [
					...entry.messages.filter((m) => m.id !== userMsg.id),
					userMsg,
					assistantMsg,
				];

				return cacheUpdate(s, convId, {
					messages: updatedMessages,
					streaming: false,
					streamingContent: "",
					streamingReasoning: "",
					streamingToolCalls: [],
					abortController: null,
				});
			});
			get().loadList();
		};

		await chatApi.sendMessageStream(
			convId,
			content,
			providerKey,
			{
				onDelta(delta) {
					set((s) => {
						const entry = s.convCache[convId];
						if (!entry) return {};
						return cacheUpdate(s, convId, {
							streamingContent: entry.streamingContent + delta,
						});
					});
				},
				onReasoning(chunk) {
					set((s) => {
						const entry = s.convCache[convId];
						if (!entry) return {};
						return cacheUpdate(s, convId, {
							streamingReasoning: entry.streamingReasoning + chunk,
						});
					});
				},
				onToolCall(call) {
					set((s) => {
						const entry = s.convCache[convId];
						if (!entry) return {};
						const calls = [...entry.streamingToolCalls];
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
						return cacheUpdate(s, convId, { streamingToolCalls: calls });
					});
				},
				onToolResult(res) {
					set((s) => {
						const entry = s.convCache[convId];
						if (!entry) return {};
						return cacheUpdate(s, convId, {
							streamingToolCalls: entry.streamingToolCalls.map((c) =>
								c.id === res.id || (!c.id && c.status === "pending")
									? {
											...c,
											result: res.result,
											status: res.status as StreamToolCall["status"],
										}
									: c,
							),
						});
					});
				},
				onUsage(input, output) {
					streamTokenCount = input + output;
				},
				onWarning(msg) {
					toast.warning(msg, 6000);
				},
				onTitleUpdate(data) {
					if (data.conversation_id === convId) {
						set((s) => ({
							conversations: s.conversations.map((c) =>
								c.id === data.conversation_id ? { ...c, title: data.title } : c,
							),
						}));
					}
				},
				onTitleError(msg) {
					toast.error(msg);
				},
				onDone(fullContent) {
					finalize(fullContent || "(empty response)");
				},
				onError(errorMsg) {
					logStoreError("Stream error", errorMsg);
					set((s) => {
						const patch = cacheUpdate(s, convId, {
							messages: (s.convCache[convId]?.messages ?? []).filter(
								(m) => m.id !== userMsg.id,
							),
							streaming: false,
							streamingContent: "",
							streamingReasoning: "",
							streamingToolCalls: [],
							abortController: null,
						});
						return { ...patch, error: errorMsg } as Partial<ConversationState>;
					});
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
			const entry = get().convCache[convId];
			const partial = entry?.streamingContent;
			if (partial) finalize(`${partial}\n\n_(stopped)_`);
			else
				set((s) => {
					const patch = cacheUpdate(s, convId, {
						messages: (s.convCache[convId]?.messages ?? []).filter(
							(m) => m.id !== userMsg.id,
						),
						streaming: false,
						streamingContent: "",
						streamingReasoning: "",
						streamingToolCalls: [],
						abortController: null,
					});
					return patch;
				});
		}
	},

	stopStreaming: () => {
		const { activeId, convCache } = get();
		if (activeId && convCache[activeId]?.abortController) {
			convCache[activeId].abortController?.abort();
		}
	},

	pushSystemMessage: (content: string) => {
		const msg: Message = {
			id: `sys-${Date.now()}`,
			role: "system",
			content,
			parent_id: null,
			tool_calls: [],
			created_at: new Date().toISOString(),
		};
		set((s) => {
			const { activeId } = s;
			if (!activeId) return { messages: [...s.messages, msg] };
			return cacheUpdate(s, activeId, {
				messages: [...(s.convCache[activeId]?.messages ?? s.messages), msg],
			});
		});
	},

	setDraft: (content: string) => set({ pendingDraft: content }),
	clearDraft: () => set({ pendingDraft: null }),

	generateTitle: async (id: string, force = false) => {
		try {
			const { apiKeys } = useSettingsStore.getState();
			const existing = get().conversations.find((c) => c.id === id);
			const providerKey = existing?.provider
				? apiKeys[existing.provider]
				: undefined;
			const conv = await convApi.generateTitle(id, providerKey, force);
			set((s) => ({
				conversations: s.conversations.map((c) =>
					c.id === conv.id ? { ...c, title: conv.title } : c,
				),
			}));
		} catch (err) {
			logStoreError("Generate title failed", err);
			toast.error("Failed to generate title");
		}
	},

	clearError: () => set({ error: null }),
}));
