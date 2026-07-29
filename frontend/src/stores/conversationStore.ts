import { create } from "zustand";
import {
	type DeepThinkingRequest,
	type StreamDonePayload,
	type StreamErrorPayload,
	type StreamToolCall,
	chatApi,
} from "../services/chat";
import type {
	Conversation,
	ConversationDetail,
	Message,
} from "../services/conversation";
import * as convApi from "../services/conversation";
import { modelHasCapability } from "../utils/modelCapabilities";
import { useProviderStore } from "./providerStore";
import { useSettingsStore } from "./settingsStore";
import { toast } from "./toastStore";

export const NEW_CONVERSATION_DRAFT_KEY = "__new_conversation__";

const conversationLoads = new Map<string, Promise<ConversationDetail>>();
const transientPrefetchClaims = new Set<string>();

function loadConversationDetail(id: string): Promise<ConversationDetail> {
	const existing = conversationLoads.get(id);
	if (existing) return existing;
	const request = convApi.getConversation(id).finally(() => {
		conversationLoads.delete(id);
	});
	conversationLoads.set(id, request);
	return request;
}

// ---- per-conversation cache (supports concurrent background streams) ----

interface ConvCacheEntry {
	messages: Message[];
	streaming: boolean;
	streamingContent: string;
	streamingReasoning: string;
	streamingDurationMs: number;
	streamingToolCalls: StreamToolCall[];
	abortController: AbortController | null;
}

export interface NewConversationSelection {
	provider: string;
	model: string;
	characterId?: string;
}

function emptyCacheEntry(messages: Message[] = []): ConvCacheEntry {
	return {
		messages,
		streaming: false,
		streamingContent: "",
		streamingReasoning: "",
		streamingDurationMs: 0,
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
		streamingDurationMs: s.streamingDurationMs,
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

function reconcileTurnMessages(
	messages: Message[],
	optimisticID: string,
	userMessage: Message,
	assistantMessage?: Message | null,
): Message[] {
	const withoutTurn = messages.filter(
		(message) =>
			message.id !== optimisticID &&
			message.id !== userMessage.id &&
			message.parent_id !== userMessage.id &&
			message.id !== assistantMessage?.id,
	);
	return assistantMessage
		? [...withoutTurn, userMessage, assistantMessage]
		: [...withoutTurn, userMessage];
}

function isTerminalMessage(message: Message | undefined): boolean {
	return Boolean(message && message.status !== "pending");
}

function deepThinkingRequest(
	providerId: string,
	modelId: string,
	enabled: boolean,
): DeepThinkingRequest | undefined {
	if (!enabled) return undefined;
	const profiles = useProviderStore.getState().profiles;
	if (!modelHasCapability(profiles, providerId, modelId, "reasoning")) {
		return undefined;
	}
	const profile = profiles.find((item) => item.id === providerId);
	return profile?.protocol === "anthropic"
		? { thinking_budget: 2048 }
		: { reasoning_effort: "high" };
}

// ---- store ----

interface ConversationState {
	conversations: Conversation[];
	activeId: string | null;
	listLoading: boolean;
	listError: string | null;

	// Top-level view fields — always mirror the active conversation's cache entry.
	messages: Message[];
	loading: boolean;
	streaming: boolean;
	streamingContent: string;
	streamingReasoning: string;
	streamingDurationMs: number;
	streamingToolCalls: StreamToolCall[];
	error: string | null;
	abortController: AbortController | null;
	pendingDraft: string | null;
	drafts: Record<string, string>;
	scrollPositions: Record<string, number>;

	// Per-conversation state pool.
	convCache: Record<string, ConvCacheEntry>;
	prefetchedConversationIds: Record<string, true>;

	loadList: () => Promise<void>;
	prefetchConversation: (id: string) => Promise<void>;
	releaseConversationPrefetch: (id: string) => void;
	selectConversation: (id: string) => Promise<void>;
	newConversation: (selection?: NewConversationSelection) => Promise<string>;
	deleteConversation: (id: string) => Promise<void>;
	renameConversation: (id: string, title: string) => Promise<void>;
	updateConversationModel: (
		id: string,
		provider: string,
		model: string,
	) => Promise<void>;
	sendMessage: (content: string) => Promise<void>;
	stopStreaming: () => void;
	pushSystemMessage: (content: string) => void;
	setDraft: (content: string) => void;
	clearDraft: () => void;
	setConversationDraft: (id: string | null, content: string) => void;
	clearConversationDraft: (id: string | null) => void;
	setConversationScrollPosition: (id: string, scrollTop: number) => void;
	clearError: () => void;
	generateTitle: (id: string, force?: boolean) => Promise<void>;
}

export const useConversationStore = create<ConversationState>((set, get) => ({
	conversations: [],
	activeId: null,
	listLoading: false,
	listError: null,
	messages: [],
	loading: false,
	streaming: false,
	streamingContent: "",
	streamingReasoning: "",
	streamingDurationMs: 0,
	streamingToolCalls: [],
	error: null,
	abortController: null,
	pendingDraft: null,
	drafts: {},
	scrollPositions: {},
	convCache: {},
	prefetchedConversationIds: {},

	loadList: async () => {
		set({ listLoading: true, listError: null });
		try {
			const resp = await convApi.listConversations();
			set({
				conversations: resp.conversations,
				listLoading: false,
				listError: null,
			});
		} catch (err) {
			logStoreError("Failed to load conversations", err);
			set({ listLoading: false, listError: "Failed to load conversations" });
		}
	},

	prefetchConversation: async (id: string) => {
		if (!id || get().activeId === id || get().convCache[id]) return;
		transientPrefetchClaims.add(id);
		try {
			const detail = await loadConversationDetail(id);
			if (!transientPrefetchClaims.has(id) || get().activeId === id) return;
			set((s) => {
				if (s.convCache[id]) return {};
				return {
					convCache: {
						...s.convCache,
						[id]: emptyCacheEntry(detail.messages),
					},
					prefetchedConversationIds: {
						...s.prefetchedConversationIds,
						[id]: true,
					},
				};
			});
		} catch (error) {
			transientPrefetchClaims.delete(id);
			logStoreError("Conversation prefetch failed", error);
		}
	},

	releaseConversationPrefetch: (id: string) => {
		transientPrefetchClaims.delete(id);
		set((s) => {
			if (!s.prefetchedConversationIds[id] || s.activeId === id) return {};
			const convCache = { ...s.convCache };
			const prefetchedConversationIds = { ...s.prefetchedConversationIds };
			delete convCache[id];
			delete prefetchedConversationIds[id];
			return { convCache, prefetchedConversationIds };
		});
	},

	selectConversation: async (id: string) => {
		transientPrefetchClaims.delete(id);
		const current = get();
		const convCache = saveActiveViewToCache(current);
		const prefetchedConversationIds = {
			...current.prefetchedConversationIds,
		};
		delete prefetchedConversationIds[id];

		// Restore from cache if available.
		const cached = convCache[id];
		if (cached) {
			set({
				activeId: id,
				messages: cached.messages,
				streaming: cached.streaming,
				streamingContent: cached.streamingContent,
				streamingReasoning: cached.streamingReasoning,
				streamingDurationMs: cached.streamingDurationMs,
				streamingToolCalls: cached.streamingToolCalls,
				abortController: cached.abortController,
				loading: false,
				error: null,
				convCache,
				prefetchedConversationIds,
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
			streamingDurationMs: 0,
			streamingToolCalls: [],
			error: null,
			convCache,
			prefetchedConversationIds,
		});
		try {
			const detail = await loadConversationDetail(id);
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

	newConversation: async (selection) => {
		const shouldMigrateTemporaryDraft = get().activeId === null;
		try {
			const defaults = useSettingsStore.getState();
			const provider = selection?.provider ?? defaults.provider ?? "";
			const model = selection?.model ?? defaults.model ?? "";
			const conv = selection?.characterId
				? await convApi.createConversation(
						"New Chat",
						provider,
						model,
						selection.characterId,
					)
				: await convApi.createConversation("New Chat", provider, model);
			await get().loadList();
			const entry = emptyCacheEntry([]);
			set((s) => {
				const drafts = { ...s.drafts };
				if (
					shouldMigrateTemporaryDraft &&
					Object.hasOwn(drafts, NEW_CONVERSATION_DRAFT_KEY)
				) {
					drafts[conv.id] = drafts[NEW_CONVERSATION_DRAFT_KEY];
					delete drafts[NEW_CONVERSATION_DRAFT_KEY];
				}
				return {
					conversations: s.conversations.some((item) => item.id === conv.id)
						? s.conversations.map((item) => (item.id === conv.id ? conv : item))
						: [conv, ...s.conversations],
					activeId: conv.id,
					messages: [],
					loading: false,
					streaming: false,
					streamingContent: "",
					streamingReasoning: "",
					streamingDurationMs: 0,
					streamingToolCalls: [],
					abortController: null,
					error: null,
					drafts,
					convCache: { ...saveActiveViewToCache(s), [conv.id]: entry },
				};
			});
			return conv.id;
		} catch (err) {
			logStoreError("Failed to create conversation", err);
			set({ error: "Failed to create conversation" });
			toast.error("Failed to create conversation");
			return "";
		}
	},

	deleteConversation: async (id: string) => {
		transientPrefetchClaims.delete(id);
		try {
			await convApi.deleteConversation(id);
			const {
				activeId,
				convCache,
				drafts,
				scrollPositions,
				prefetchedConversationIds,
			} = get();
			const newCache = { ...convCache };
			const nextDrafts = { ...drafts };
			const nextScrollPositions = { ...scrollPositions };
			const nextPrefetchedConversationIds = {
				...prefetchedConversationIds,
			};
			delete newCache[id];
			delete nextDrafts[id];
			delete nextScrollPositions[id];
			delete nextPrefetchedConversationIds[id];
			if (activeId === id) {
				set({
					activeId: null,
					messages: [],
					loading: false,
					streaming: false,
					streamingContent: "",
					streamingReasoning: "",
					streamingDurationMs: 0,
					streamingToolCalls: [],
					abortController: null,
					convCache: newCache,
					prefetchedConversationIds: nextPrefetchedConversationIds,
					drafts: nextDrafts,
					scrollPositions: nextScrollPositions,
				});
			} else {
				set({
					convCache: newCache,
					prefetchedConversationIds: nextPrefetchedConversationIds,
					drafts: nextDrafts,
					scrollPositions: nextScrollPositions,
				});
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

	updateConversationModel: async (id, provider, model) => {
		const nextProvider = provider.trim();
		const nextModel = model.trim();
		if (!id || !nextProvider || !nextModel) return;
		const previous = get().conversations.find(
			(conversation) => conversation.id === id,
		);
		if (!previous) return;
		if (previous.provider === nextProvider && previous.model === nextModel)
			return;

		set((s) => ({
			conversations: s.conversations.map((conversation) =>
				conversation.id === id
					? { ...conversation, provider: nextProvider, model: nextModel }
					: conversation,
			),
			error: null,
		}));
		try {
			const updated = await convApi.updateConversationModel(
				id,
				nextProvider,
				nextModel,
			);
			set((s) => ({
				conversations: s.conversations.map((conversation) =>
					conversation.id === id
						? { ...conversation, ...updated }
						: conversation,
				),
			}));
		} catch (error) {
			logStoreError("Conversation model update failed", error);
			set((s) => ({
				conversations: s.conversations.map((conversation) =>
					conversation.id === id &&
					conversation.provider === nextProvider &&
					conversation.model === nextModel
						? {
								...conversation,
								provider: previous.provider,
								model: previous.model,
							}
						: conversation,
				),
				error: "Failed to update conversation model",
			}));
			toast.error("Failed to update conversation model");
		}
	},

	sendMessage: async (content: string) => {
		const { activeId, messages } = get();
		let convId = activeId;

		if (!convId) {
			convId = await get().newConversation();
			if (!convId) return;
		}

		get().clearConversationDraft(convId);

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
		const {
			provider,
			model,
			apiKeys,
			searchEnabled,
			searchProvider,
			deepThinking,
		} = useSettingsStore.getState();
		const conversation = get().conversations.find((c) => c.id === convId);
		const convProvider = conversation?.provider || provider;
		const convModel = conversation?.model || model;
		const providerKey = convProvider ? apiKeys[convProvider] : undefined;
		const thinking = deepThinkingRequest(convProvider, convModel, deepThinking);
		const nativeWebSearch = modelHasCapability(
			useProviderStore.getState().profiles,
			convProvider,
			convModel,
			"web",
		);
		const externalSearchEnabled = searchEnabled && !nativeWebSearch;

		// Optimistic user message
		const userMsg: Message = {
			id: `user-${Date.now()}`,
			role: "user",
			content,
			parent_id: null,
			tool_calls: [],
			status: "pending",
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
				streamingDurationMs: 0,
				streamingToolCalls: [],
				abortController: controller,
			});
			return {
				...patch,
				error: null,
			} as Partial<ConversationState>;
		});

		let authoritativeTurnID: string | undefined;
		let shouldReconcile = false;

		const applyDone = (result: StreamDonePayload) => {
			authoritativeTurnID = result.user_message.id;
			set((s) => {
				const entry = s.convCache[convId];
				if (!entry) return {};

				return cacheUpdate(s, convId, {
					messages: reconcileTurnMessages(
						entry.messages,
						userMsg.id,
						result.user_message,
						result.assistant_message,
					),
					streaming: false,
					streamingContent: "",
					streamingReasoning: "",
					streamingDurationMs: 0,
					streamingToolCalls: [],
					abortController: null,
				});
			});
			get().loadList();
		};

		const applyError = (error: StreamErrorPayload) => {
			shouldReconcile = true;
			if (error.user_message) authoritativeTurnID = error.user_message.id;
			logStoreError("Stream error", error.message);
			set((s) => {
				const entry = s.convCache[convId];
				if (!entry) return { error: error.message };
				let nextMessages = entry.messages;
				if (error.user_message) {
					nextMessages = reconcileTurnMessages(
						entry.messages,
						userMsg.id,
						error.user_message,
						error.assistant_message,
					);
				} else if (!authoritativeTurnID) {
					nextMessages = entry.messages.filter(
						(message) => message.id !== userMsg.id,
					);
				}
				const patch = cacheUpdate(s, convId, {
					messages: nextMessages,
					streaming: false,
					streamingContent: "",
					streamingReasoning: "",
					streamingDurationMs: 0,
					streamingToolCalls: [],
					abortController: null,
				});
				return { ...patch, error: error.message } as Partial<ConversationState>;
			});
			toast.error(error.message);
		};

		const reconcileFromEngine = async () => {
			for (let attempt = 0; attempt < 4; attempt++) {
				try {
					const detail = await convApi.getConversation(convId);
					set((s) =>
						cacheUpdate(s, convId, {
							messages: detail.messages,
							streaming: false,
							streamingContent: "",
							streamingReasoning: "",
							streamingDurationMs: 0,
							streamingToolCalls: [],
							abortController: null,
						}),
					);
					const turn = authoritativeTurnID
						? detail.messages.find(
								(message) => message.id === authoritativeTurnID,
							)
						: undefined;
					if (!authoritativeTurnID || isTerminalMessage(turn)) return;
				} catch (error) {
					logStoreError("Failed to reconcile chat turn", error);
					return;
				}
				await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
			}
		};

		await chatApi.sendMessageStream(
			convId,
			content,
			providerKey,
			{
				onTurnStarted(persistedUser) {
					authoritativeTurnID = persistedUser.id;
					set((s) => {
						const entry = s.convCache[convId];
						if (!entry) return {};
						return cacheUpdate(s, convId, {
							messages: reconcileTurnMessages(
								entry.messages,
								userMsg.id,
								persistedUser,
							),
						});
					});
				},
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
				onTelemetry(durationMs) {
					set((s) => {
						const entry = s.convCache[convId];
						if (!entry) return {};
						return cacheUpdate(s, convId, {
							streamingDurationMs: Math.max(
								entry.streamingDurationMs,
								durationMs,
							),
						});
					});
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
				onDone(result) {
					applyDone(result);
				},
				onError(error) {
					applyError(error);
				},
			},
			controller.signal,
			externalSearchEnabled,
			searchProvider,
			thinking,
		);

		// Gateway persists Stop with a detached, bounded cleanup context. Reload
		// until Engine exposes that terminal state; the renderer never uploads or
		// manufactures a partial assistant message.
		if (controller.signal.aborted) {
			shouldReconcile = true;
			set((s) =>
				cacheUpdate(s, convId, {
					streaming: false,
					streamingContent: "",
					streamingReasoning: "",
					streamingDurationMs: 0,
					streamingToolCalls: [],
					abortController: null,
				}),
			);
		}
		if (shouldReconcile) {
			await reconcileFromEngine();
			get().loadList();
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
			status: "completed",
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
	setConversationDraft: (id, content) => {
		const key = id ?? NEW_CONVERSATION_DRAFT_KEY;
		set((s) => {
			const drafts = { ...s.drafts };
			if (content) drafts[key] = content;
			else delete drafts[key];
			return { drafts };
		});
	},
	clearConversationDraft: (id) => {
		const key = id ?? NEW_CONVERSATION_DRAFT_KEY;
		set((s) => {
			if (!Object.hasOwn(s.drafts, key)) return s;
			const drafts = { ...s.drafts };
			delete drafts[key];
			return { drafts };
		});
	},
	setConversationScrollPosition: (id, scrollTop) => {
		if (!id || !Number.isFinite(scrollTop)) return;
		set((s) => ({
			scrollPositions: {
				...s.scrollPositions,
				[id]: Math.max(0, scrollTop),
			},
		}));
	},

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
