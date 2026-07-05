import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamCallbacks } from "../services/chat";

// chatApi is mocked per test so the store doesn't hit the network.
const sendMessageStream = vi.fn();
vi.mock("../services/chat", () => ({
	chatApi: {
		sendMessage: vi.fn(),
		sendMessageStream: (...args: unknown[]) => sendMessageStream(...args),
	},
}));

// conversation API mocked too so newConversation/deleteConversation/loadList
// are no-ops.
const renameConversationApi = vi.fn();
const generateTitleApi = vi.fn();
const getConversationApi = vi.fn();
const listConversationsApi = vi.fn();
const createConversationApi = vi.fn();
vi.mock("../services/conversation", () => ({
	listConversations: (...args: unknown[]) => listConversationsApi(...args),
	createConversation: (...args: unknown[]) => createConversationApi(...args),
	getConversation: (...args: unknown[]) => getConversationApi(...args),
	deleteConversation: vi.fn().mockResolvedValue(undefined),
	renameConversation: (...args: unknown[]) => renameConversationApi(...args),
	generateTitle: (...args: unknown[]) => generateTitleApi(...args),
}));

// Force module evaluation order: import store after the mocks above.
import { useConversationStore } from "./conversationStore";
import { useSettingsStore } from "./settingsStore";

beforeEach(() => {
	useConversationStore.setState({
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
	});
	sendMessageStream.mockReset();
	renameConversationApi.mockReset();
	generateTitleApi.mockReset();
	generateTitleApi.mockResolvedValue({
		id: "c1",
		title: "Generated",
		provider: "anthropic",
		model: "claude",
		message_count: 2,
		created_at: "",
		updated_at: "",
	});
	getConversationApi.mockReset();
	getConversationApi.mockImplementation((id: string) =>
		Promise.resolve({
			id,
			title: `Conversation ${id}`,
			messages: [],
		}),
	);
	listConversationsApi.mockReset();
	listConversationsApi.mockResolvedValue({ conversations: [] });
	createConversationApi.mockReset();
	createConversationApi.mockImplementation(
		(title: string, provider: string, model: string) =>
			Promise.resolve({ id: "new-c1", title, provider, model }),
	);
	useSettingsStore.setState({
		provider: "openai",
		model: "gpt-4o",
		apiKeys: { openai: "openai-key", anthropic: "anthropic-key" },
	});
});

// ---- helpers ----

function seedConversation(id: string, title = "Chat", messages: unknown[] = []) {
	useConversationStore.setState({
		conversations: [
			...useConversationStore.getState().conversations,
			{
				id,
				title,
				provider: "openai",
				model: "gpt-4o",
				message_count: messages.length,
				created_at: "",
				updated_at: "",
			},
		],
	});
}

// ---- tests ----

describe("pushSystemMessage", () => {
	it("appends a role:system message in place", () => {
		useConversationStore.getState().pushSystemMessage("hello");
		const msgs = useConversationStore.getState().messages;
		expect(msgs).toHaveLength(1);
		expect(msgs[0].role).toBe("system");
		expect(msgs[0].content).toBe("hello");
	});
});

describe("draft mailbox", () => {
	it("setDraft writes pendingDraft, clearDraft resets it", () => {
		const store = useConversationStore.getState();
		expect(store.pendingDraft).toBeNull();
		store.setDraft("> quoted memory");
		expect(useConversationStore.getState().pendingDraft).toBe(
			"> quoted memory",
		);
		useConversationStore.getState().clearDraft();
		expect(useConversationStore.getState().pendingDraft).toBeNull();
	});
});

describe("renameConversation", () => {
	const seed = (title: string) =>
		useConversationStore.setState({
			conversations: [
				{
					id: "c1",
					title,
					provider: "",
					model: "",
					message_count: 0,
					created_at: "",
					updated_at: "",
				},
			],
		});

	it("optimistically updates the title and persists on success", async () => {
		seed("old");
		renameConversationApi.mockResolvedValueOnce({});
		await useConversationStore.getState().renameConversation("c1", "  new  ");
		expect(useConversationStore.getState().conversations[0].title).toBe("new");
		expect(renameConversationApi).toHaveBeenCalledWith("c1", "new");
	});

	it("rolls back the title and surfaces error on server failure", async () => {
		seed("old");
		renameConversationApi.mockRejectedValueOnce(new Error("nope"));
		await useConversationStore.getState().renameConversation("c1", "new");
		const s = useConversationStore.getState();
		expect(s.conversations[0].title).toBe("old");
		expect(s.error).toBe("Rename failed");
	});

	it("ignores empty/whitespace titles without calling the API", async () => {
		seed("kept");
		await useConversationStore.getState().renameConversation("c1", "   ");
		expect(renameConversationApi).not.toHaveBeenCalled();
		expect(useConversationStore.getState().conversations[0].title).toBe("kept");
	});
});

describe("sendMessage", () => {
	it("removes the optimistic user message on stream error", async () => {
		sendMessageStream.mockImplementation(
			async (
				_id: string,
				_content: string,
				_key: string | undefined,
				cb: StreamCallbacks,
			) => {
				cb.onError("boom");
			},
		);

		// Pre-seed an active conversation so newConversation is skipped.
		useConversationStore.setState({ activeId: "c1" });

		await useConversationStore.getState().sendMessage("hi");

		const s = useConversationStore.getState();
		expect(s.streaming).toBe(false);
		expect(s.error).toBe("boom");
		expect(s.messages.find((m) => m.role === "user")).toBeUndefined();
	});

	it("finalizes with assistant message on onDone", async () => {
		sendMessageStream.mockImplementation(
			async (
				_id: string,
				_content: string,
				_key: string | undefined,
				cb: StreamCallbacks,
			) => {
				cb.onDelta("partial ");
				cb.onDelta("rest");
				cb.onDone("partial rest");
			},
		);

		useConversationStore.setState({ activeId: "c1" });
		await useConversationStore.getState().sendMessage("hi");

		const s = useConversationStore.getState();
		expect(s.streaming).toBe(false);
		expect(s.streamingContent).toBe("");
		const roles = s.messages.map((m) => m.role);
		expect(roles).toEqual(["user", "assistant"]);
		expect(s.messages[1].content).toBe("partial rest");
	});

	it("accumulates reasoning and indexed tool-call fragments into the final message", async () => {
		sendMessageStream.mockImplementation(
			async (
				_id: string,
				_content: string,
				_key: string | undefined,
				cb: StreamCallbacks,
			) => {
				cb.onReasoning?.("step 1 ");
				cb.onReasoning?.("step 2");
				cb.onToolCall?.({ index: 0, id: "t0", name: "search" });
				cb.onToolCall?.({ index: 0, arguments: '{"q":' });
				cb.onToolCall?.({ index: 0, arguments: '"cats"}' });
				cb.onToolResult?.({ id: "t0", result: "found", status: "success" });
				cb.onDone("here you go");
			},
		);

		useConversationStore.setState({ activeId: "c1" });
		await useConversationStore.getState().sendMessage("hi");

		const s = useConversationStore.getState();
		const asst = s.messages[1];
		expect(asst.reasoning).toBe("step 1 step 2");
		expect(asst.tool_calls).toHaveLength(1);
		expect(asst.tool_calls[0].name).toBe("search");
		expect(asst.tool_calls[0].arguments).toBe('{"q":"cats"}');
		expect(asst.tool_calls[0].result).toBe("found");
		expect(asst.tool_calls[0].status).toBe("success");
		// Streaming scratch state is cleared after finalize.
		expect(s.streamingReasoning).toBe("");
		expect(s.streamingToolCalls).toEqual([]);
	});

	it("uses title_update without issuing a second title generation request", async () => {
		sendMessageStream.mockImplementation(
			async (
				_id: string,
				_content: string,
				_key: string | undefined,
				cb: StreamCallbacks,
			) => {
				cb.onTitleUpdate?.({ conversation_id: "c1", title: "Stream Title" });
				cb.onDone("done");
			},
		);

		// loadList is called inside finalize; the mock must preserve the
		// conversation so the test can assert the title was updated.
		listConversationsApi.mockResolvedValue({
			conversations: [
				{
					id: "c1",
					title: "Stream Title",
					provider: "anthropic",
					model: "claude",
					message_count: 2,
					created_at: "",
					updated_at: "",
				},
			],
		});

		useConversationStore.setState({
			activeId: "c1",
			conversations: [
				{
					id: "c1",
					title: "New Chat",
					provider: "anthropic",
					model: "claude",
					message_count: 0,
					created_at: "",
					updated_at: "",
				},
			],
		});
		await useConversationStore.getState().sendMessage("hi");

		expect(generateTitleApi).not.toHaveBeenCalled();
		expect(useConversationStore.getState().conversations[0].title).toBe(
			"Stream Title",
		);
	});

	it("sends chat with the active conversation provider key", async () => {
		sendMessageStream.mockImplementation(
			async (
				_id: string,
				_content: string,
				_key: string | undefined,
				cb: StreamCallbacks,
			) => {
				cb.onDone("done");
			},
		);

		useConversationStore.setState({
			activeId: "c1",
			conversations: [
				{
					id: "c1",
					title: "Existing",
					provider: "anthropic",
					model: "claude",
					message_count: 2,
					created_at: "",
					updated_at: "",
				},
			],
		});
		await useConversationStore.getState().sendMessage("hi");

		expect(sendMessageStream.mock.calls[0][2]).toBe("anthropic-key");
	});

	it("does not issue a second title generation request when stream has no title event", async () => {
		sendMessageStream.mockImplementation(
			async (
				_id: string,
				_content: string,
				_key: string | undefined,
				cb: StreamCallbacks,
			) => {
				cb.onDone("done");
			},
		);

		useConversationStore.setState({
			activeId: "c1",
			conversations: [
				{
					id: "c1",
					title: "New Chat",
					provider: "anthropic",
					model: "claude",
					message_count: 0,
					created_at: "",
					updated_at: "",
				},
			],
		});
		await useConversationStore.getState().sendMessage("hi");

		expect(generateTitleApi).not.toHaveBeenCalled();
	});

	it("surfaces hidden automatic-title errors without a second generation request", async () => {
		sendMessageStream.mockImplementation(
			async (
				_id: string,
				_content: string,
				_key: string | undefined,
				cb: StreamCallbacks,
			) => {
				cb.onTitleError?.("Failed to generate title");
				cb.onDone("done");
			},
		);

		useConversationStore.setState({
			activeId: "c1",
			conversations: [
				{
					id: "c1",
					title: "New Chat",
					provider: "anthropic",
					model: "claude",
					message_count: 0,
					created_at: "",
					updated_at: "",
				},
			],
		});
		await useConversationStore.getState().sendMessage("hi");

		expect(generateTitleApi).not.toHaveBeenCalled();
	});
});

describe("generateTitle", () => {
	it("uses the conversation provider key and forwards force", async () => {
		useConversationStore.setState({
			conversations: [
				{
					id: "c1",
					title: "Manual",
					provider: "anthropic",
					model: "claude",
					message_count: 2,
					created_at: "",
					updated_at: "",
				},
			],
		});

		await useConversationStore.getState().generateTitle("c1", true);

		expect(generateTitleApi).toHaveBeenCalledWith("c1", "anthropic-key", true);
		expect(useConversationStore.getState().conversations[0].title).toBe(
			"Generated",
		);
	});
});

describe("stopStreaming", () => {
	it("aborts the active controller and finalizes the partial reply", async () => {
		sendMessageStream.mockImplementation(
			async (
				_id: string,
				_content: string,
				_key: string | undefined,
				cb: StreamCallbacks,
				signal: AbortSignal,
			) => {
				cb.onDelta("hello");
				// Don't call onDone — caller will abort.
				await new Promise<void>((resolve, reject) => {
					if (signal.aborted) {
						reject(new DOMException("aborted", "AbortError"));
						return;
					}
					signal.addEventListener("abort", () =>
						reject(new DOMException("aborted", "AbortError")),
					);
				}).catch(() => {
					// chat.ts swallows AbortError; mimic that contract.
				});
			},
		);

		useConversationStore.setState({ activeId: "c1" });
		const send = useConversationStore.getState().sendMessage("hi");

		// Wait a tick for the stream to start, then stop.
		await new Promise((r) => setTimeout(r, 0));
		useConversationStore.getState().stopStreaming();
		await send;

		const s = useConversationStore.getState();
		expect(s.streaming).toBe(false);
		const last = s.messages.at(-1);
		expect(last?.role).toBe("assistant");
		expect(last?.content).toContain("hello");
		expect(last?.content).toContain("(stopped)");
	});
});

// ---- helpers for building stream mocks that respect abort signals ----

/** A stream mock that never finishes on its own; aborts via the signal. */
function hangingStream(impl: {
	onDelta?: (d: string) => void;
	onDone?: (c: string) => void;
	setup?: (cb: StreamCallbacks) => void;
}) {
	return async (
		_id: string,
		_content: string,
		_key: string | undefined,
		cb: StreamCallbacks,
		signal: AbortSignal,
	) => {
		impl.setup?.(cb);
		await new Promise<void>((resolve, reject) => {
			if (signal.aborted) {
				reject(new DOMException("aborted", "AbortError"));
				return;
			}
			const onAbort = () => reject(new DOMException("aborted", "AbortError"));
			signal.addEventListener("abort", onAbort, { once: true });
		});
	};
}

/** Abort the controller cached for a conversation so its stream promise settles. */
function abortConv(id: string) {
	useConversationStore.getState().convCache[id]?.abortController?.abort();
}

// ---- multi-conversation streaming ----

describe("multi-conversation streaming", () => {
	it("keeps background stream in cache after switching away", async () => {
		// A is streaming, then user switches to B.
		// A's streaming state must survive in convCache["a"].
		useConversationStore.setState({ activeId: "a", convCache: {} });

		let deltaCb: ((d: string) => void) | undefined;
		sendMessageStream.mockImplementation(
			hangingStream({
				setup(cb) {
					deltaCb = cb.onDelta;
				},
			}),
		);

		const promise = useConversationStore.getState().sendMessage("to A");
		await new Promise((r) => setTimeout(r, 0));

		// Emit one delta so A has some content.
		deltaCb?.("A-partial");
		await new Promise((r) => setTimeout(r, 0));

		expect(useConversationStore.getState().streamingContent).toBe("A-partial");

		// Switch to B (first visit — server fetch).
		await useConversationStore.getState().selectConversation("b");

		// B's view is clean.
		expect(useConversationStore.getState().activeId).toBe("b");
		expect(useConversationStore.getState().streaming).toBe(false);
		expect(useConversationStore.getState().streamingContent).toBe("");

		// A's cache still holds the in-flight stream.
		const cacheA = useConversationStore.getState().convCache["a"];
		expect(cacheA).toBeDefined();
		expect(cacheA.streaming).toBe(true);
		expect(cacheA.streamingContent).toBe("A-partial");

		// Cleanup — abort A's controller directly (B is active, stopStreaming
		// would only abort B which has no stream).
		abortConv("a");
		await promise.catch(() => {});
	});

	it("restores streaming progress when switching back", async () => {
		// A is streaming, user switches to B, then back to A.
		// A's view should show the in-progress stream content.
		useConversationStore.setState({ activeId: "a", convCache: {} });

		let deltaCb: ((d: string) => void) | undefined;
		sendMessageStream.mockImplementation(
			hangingStream({
				setup(cb) {
					deltaCb = cb.onDelta;
				},
			}),
		);

		const promise = useConversationStore.getState().sendMessage("to A");
		await new Promise((r) => setTimeout(r, 0));
		deltaCb?.("A-partial-");
		await new Promise((r) => setTimeout(r, 0));

		// Switch to B.
		await useConversationStore.getState().selectConversation("b");
		expect(useConversationStore.getState().activeId).toBe("b");

		// Switch back to A — should restore from cache.
		await useConversationStore.getState().selectConversation("a");
		expect(useConversationStore.getState().activeId).toBe("a");
		expect(useConversationStore.getState().streaming).toBe(true);
		expect(useConversationStore.getState().streamingContent).toBe("A-partial-");

		// Cleanup.
		abortConv("a");
		await promise.catch(() => {});
	});

	it("starts a clean new conversation while the previous one streams in background", async () => {
		// A is streaming, then user creates B with the New Chat button.
		// B must not inherit A's streaming lock or partial content.
		useConversationStore.setState({ activeId: "a", convCache: {} });

		let deltaCb: ((d: string) => void) | undefined;
		sendMessageStream.mockImplementation(
			hangingStream({
				setup(cb) {
					deltaCb = cb.onDelta;
				},
			}),
		);

		const promise = useConversationStore.getState().sendMessage("to A");
		await new Promise((r) => setTimeout(r, 0));
		deltaCb?.("A-partial");
		await new Promise((r) => setTimeout(r, 0));

		const newId = await useConversationStore.getState().newConversation();

		expect(newId).toBe("new-c1");
		expect(useConversationStore.getState().activeId).toBe("new-c1");
		expect(useConversationStore.getState().messages).toEqual([]);
		expect(useConversationStore.getState().streaming).toBe(false);
		expect(useConversationStore.getState().streamingContent).toBe("");
		expect(useConversationStore.getState().streamingReasoning).toBe("");
		expect(useConversationStore.getState().streamingToolCalls).toEqual([]);
		expect(useConversationStore.getState().abortController).toBeNull();

		deltaCb?.("-after-new");
		await new Promise((r) => setTimeout(r, 0));

		expect(useConversationStore.getState().streamingContent).toBe("");
		expect(
			useConversationStore.getState().convCache["a"].streamingContent,
		).toBe("A-partial-after-new");
		expect(useConversationStore.getState().convCache["a"].streaming).toBe(
			true,
		);

		abortConv("a");
		await promise.catch(() => {});
	});

	it("does not show A deltas in B view", async () => {
		// A is streaming in background; user is viewing B.
		// A's deltas must never appear in B's streamingContent.
		useConversationStore.setState({ activeId: "a", convCache: {} });

		let deltaCb: ((d: string) => void) | undefined;
		sendMessageStream.mockImplementation(
			hangingStream({
				setup(cb) {
					deltaCb = cb.onDelta;
				},
			}),
		);

		const promise = useConversationStore.getState().sendMessage("to A");
		await new Promise((r) => setTimeout(r, 0));

		// Switch to B before any deltas fire.
		await useConversationStore.getState().selectConversation("b");
		expect(useConversationStore.getState().streamingContent).toBe("");

		// A's stream delivers a delta — must NOT leak into B's view.
		deltaCb?.("SHOULD-STAY-IN-A");
		await new Promise((r) => setTimeout(r, 0));

		expect(useConversationStore.getState().streamingContent).toBe("");
		expect(
			useConversationStore.getState().convCache["a"].streamingContent,
		).toBe("SHOULD-STAY-IN-A");

		// Cleanup.
		abortConv("a");
		await promise.catch(() => {});
	});

	it("writes A finalize to A cache, not B view", async () => {
		// A completes while user is viewing B.
		// The assistant message must land in cache["a"].messages, not B's.
		useConversationStore.setState({ activeId: "a", convCache: {} });

		let doneCb: ((c: string) => void) | undefined;
		let resolveStream: (() => void) | undefined;
		sendMessageStream.mockImplementation(
			async (
				_id: string,
				_content: string,
				_key: string | undefined,
				cb: StreamCallbacks,
				signal: AbortSignal,
			) => {
				doneCb = cb.onDone;
				await new Promise<void>((resolve, reject) => {
					resolveStream = resolve;
					if (signal.aborted) {
						reject(new DOMException("aborted", "AbortError"));
						return;
					}
					const onAbort = () =>
						reject(new DOMException("aborted", "AbortError"));
					signal.addEventListener("abort", onAbort, { once: true });
				});
			},
		);

		const promise = useConversationStore.getState().sendMessage("to A");
		await new Promise((r) => setTimeout(r, 0));

		// Switch to B.
		await useConversationStore.getState().selectConversation("b");

		// A's stream completes. finalize runs synchronously inside onDone,
		// writing the assistant message to cache["a"].
		doneCb?.("A final answer");
		await new Promise((r) => setTimeout(r, 0));

		// B's view messages must NOT contain A's answer.
		const bMsgs = useConversationStore.getState().messages;
		expect(bMsgs.find((m) => m.content === "A final answer")).toBeUndefined();

		// A's cache must have the assistant message.
		const aMsgs = useConversationStore.getState().convCache["a"].messages;
		const asst = aMsgs.find((m) => m.role === "assistant");
		expect(asst?.content).toBe("A final answer");

		// Resolve the stream so sendMessage can finish.
		resolveStream?.();
		await promise;
	});

	it("supports two concurrent streams without cross-talk", async () => {
		// A and B both stream concurrently. Their deltas must not mix.
		useConversationStore.setState({ activeId: "a", convCache: {} });

		const deltas: Record<string, ((d: string) => void) | undefined> = {};
		sendMessageStream.mockImplementation(
			async (
				id: string,
				_content: string,
				_key: string | undefined,
				cb: StreamCallbacks,
				signal: AbortSignal,
			) => {
				deltas[id] = cb.onDelta;
				await new Promise<void>((resolve, reject) => {
					if (signal.aborted) {
						reject(new DOMException("aborted", "AbortError"));
						return;
					}
					const onAbort = () =>
						reject(new DOMException("aborted", "AbortError"));
					signal.addEventListener("abort", onAbort, { once: true });
				});
			},
		);

		// Start A.
		const pA = useConversationStore.getState().sendMessage("to A");
		await new Promise((r) => setTimeout(r, 0));

		// Switch to B and start B.
		await useConversationStore.getState().selectConversation("b");
		const pB = useConversationStore.getState().sendMessage("to B");
		await new Promise((r) => setTimeout(r, 0));

		// Both streams emit.
		deltas["a"]?.("alpha");
		deltas["b"]?.("beta");
		await new Promise((r) => setTimeout(r, 0));

		// B's view shows beta only.
		expect(useConversationStore.getState().streamingContent).toBe("beta");

		// A's cache shows alpha only.
		expect(
			useConversationStore.getState().convCache["a"].streamingContent,
		).toBe("alpha");
		expect(
			useConversationStore.getState().convCache["b"].streamingContent,
		).toBe("beta");

		// Switch back to A — should show alpha.
		await useConversationStore.getState().selectConversation("a");
		expect(useConversationStore.getState().streamingContent).toBe("alpha");

		// Cleanup — abort both controllers.
		abortConv("a");
		abortConv("b");
		await Promise.all([pA.catch(() => {}), pB.catch(() => {})]);
	});

	it("saves view to cache on switch and does not re-fetch cached conversations", async () => {
		// Visit A first time → server fetch.
		await useConversationStore.getState().selectConversation("a");
		expect(getConversationApi).toHaveBeenCalledTimes(1);
		expect(useConversationStore.getState().loading).toBe(false);

		// Switch to B first time → server fetch.
		await useConversationStore.getState().selectConversation("b");
		expect(getConversationApi).toHaveBeenCalledTimes(2);

		// Switch back to A → must NOT fetch again (cache hit).
		await useConversationStore.getState().selectConversation("a");
		expect(getConversationApi).toHaveBeenCalledTimes(2);
		expect(useConversationStore.getState().activeId).toBe("a");
	});

	it("deleteConversation removes cache entry", async () => {
		await useConversationStore.getState().selectConversation("a");
		expect(
			useConversationStore.getState().convCache["a"],
		).toBeDefined();

		await useConversationStore.getState().deleteConversation("a");
		expect(
			useConversationStore.getState().convCache["a"],
		).toBeUndefined();
		expect(useConversationStore.getState().activeId).toBeNull();
	});

	it("pushSystemMessage updates both view and cache", () => {
		useConversationStore.setState({
			activeId: "a",
			convCache: {
				a: {
					messages: [],
					streaming: false,
					streamingContent: "",
					streamingReasoning: "",
					streamingToolCalls: [],
					abortController: null,
				},
			},
		});

		useConversationStore.getState().pushSystemMessage("sys-msg");

		const s = useConversationStore.getState();
		expect(s.messages).toHaveLength(1);
		expect(s.messages[0].content).toBe("sys-msg");
		expect(s.convCache["a"].messages).toHaveLength(1);
		expect(s.convCache["a"].messages[0].content).toBe("sys-msg");
	});
});
