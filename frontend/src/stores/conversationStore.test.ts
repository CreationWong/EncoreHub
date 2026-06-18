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
}));

// Force module evaluation order: import store after the mocks above.
import { useConversationStore } from "./conversationStore";

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
