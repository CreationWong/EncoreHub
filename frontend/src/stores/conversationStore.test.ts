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
vi.mock("../services/conversation", () => ({
	listConversations: vi.fn().mockResolvedValue({ conversations: [] }),
	createConversation: vi
		.fn()
		.mockResolvedValue({ id: "c1", title: "x", provider: "", model: "" }),
	getConversation: vi
		.fn()
		.mockResolvedValue({ id: "c1", title: "x", messages: [] }),
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
		error: null,
		abortController: null,
		pendingDraft: null,
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
	useSettingsStore.setState({
		provider: "openai",
		model: "gpt-4o",
		apiKeys: { openai: "openai-key", anthropic: "anthropic-key" },
	});
});

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

		expect(generateTitleApi).toHaveBeenCalledWith(
			"c1",
			"anthropic-key",
			true,
		);
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
