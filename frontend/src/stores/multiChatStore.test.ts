import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	Conversation,
	ConversationParticipant,
	Message,
} from "../services/conversation";
import type { GroupStreamCallbacks } from "../services/groupChat";

vi.mock("../services/conversation", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../services/conversation")>();
	return {
		...actual,
		listConversations: vi.fn(),
		getConversation: vi.fn(),
		createGroupConversation: vi.fn(),
		updateConversationReplyMode: vi.fn(),
		deleteConversation: vi.fn(),
	};
});

vi.mock("../services/groupChat", () => ({
	sendGroupMessageStream: vi.fn(),
}));

import {
	createGroupConversation,
	getConversation,
	listConversations,
	updateConversationReplyMode,
} from "../services/conversation";
import { sendGroupMessageStream } from "../services/groupChat";
import { useMultiChatStore } from "./multiChatStore";

const listMock = vi.mocked(listConversations);
const getMock = vi.mocked(getConversation);
const createMock = vi.mocked(createGroupConversation);
const updateModeMock = vi.mocked(updateConversationReplyMode);
const streamMock = vi.mocked(sendGroupMessageStream);

function participant(
	id: string,
	position: number,
	name: string,
): ConversationParticipant {
	return {
		character_id: id,
		character_version: 1,
		position,
		character_snapshot: {
			name,
			avatar: "",
			description: "",
			system_prompt: "",
			opening_message: "",
			tags: [],
		},
		provider: "openai",
		model: "gpt-test",
	};
}

function conversation(
	id: string,
	overrides: Partial<Conversation> = {},
): Conversation {
	return {
		id,
		title: `Group ${id}`,
		provider: "openai",
		model: "gpt-test",
		message_count: 0,
		created_at: "2026-09-19T00:00:00Z",
		updated_at: "2026-09-19T00:00:00Z",
		participants: [
			participant("char-a", 0, "A"),
			participant("char-b", 1, "B"),
		],
		reply_mode: "sequential",
		...overrides,
	};
}

function message(overrides: Partial<Message>): Message {
	return {
		id: "message-1",
		role: "assistant",
		content: "hello",
		parent_id: null,
		tool_calls: [],
		status: "completed",
		created_at: "2026-09-19T00:00:00Z",
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	useMultiChatStore.setState({
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
	});
});

describe("multiChatStore", () => {
	it("keeps only conversations with a member roster", async () => {
		listMock.mockResolvedValue({
			conversations: [
				conversation("group-1"),
				conversation("single-1", { participants: [] }),
			],
			total: 2,
		});

		await useMultiChatStore.getState().loadConversations();

		expect(useMultiChatStore.getState().conversations.map((c) => c.id)).toEqual(
			["group-1"],
		);
	});

	it("streams one message to every member segment then reloads the transcript", async () => {
		const streaming = conversation("group-1");
		getMock
			.mockResolvedValueOnce({
				...streaming,
				messages: [],
				summary: null,
			})
			.mockResolvedValueOnce({
				...streaming,
				summary: null,
				messages: [
					message({
						id: "turn-1",
						role: "user",
						content: "开始",
						sender_character_id: null,
					}),
					message({
						id: "assistant-a",
						content: "A 收到",
						sender_character_id: "char-a",
					}),
					message({
						id: "assistant-b",
						content: "B 补充",
						sender_character_id: "char-b",
					}),
				],
			});
		listMock.mockResolvedValue({ conversations: [streaming], total: 1 });
		streamMock.mockImplementation(
			async (
				_convId,
				_content,
				_keys,
				_mentions,
				callbacks: GroupStreamCallbacks,
			) => {
				callbacks.onTurnStarted?.(
					message({ id: "turn-1", role: "user", content: "开始" }),
				);
				callbacks.onParticipantStarted?.({
					participant_id: "char-a",
					name: "A",
					avatar: "",
					provider: "openai",
					model: "gpt-test",
					position: 0,
				});
				callbacks.onDelta("char-a", "A 收到");
				callbacks.onParticipantDone?.("char-a", "A 收到", "");
				callbacks.onParticipantStarted?.({
					participant_id: "char-b",
					name: "B",
					avatar: "",
					provider: "openai",
					model: "gpt-test",
					position: 1,
				});
				callbacks.onDelta("char-b", "B 补充");
				callbacks.onParticipantDone?.("char-b", "B 补充", "");
				callbacks.onDone({
					user_message: message({ id: "turn-1", role: "user" }),
					assistant_messages: [],
					usage: { input_tokens: 1, output_tokens: 1 },
				});
			},
		);

		await useMultiChatStore.getState().openConversation("group-1");
		await useMultiChatStore.getState().sendMessage("开始", ["char-a"]);

		expect(streamMock).toHaveBeenCalledWith(
			"group-1",
			"开始",
			{},
			["char-a"],
			expect.any(Object),
			expect.any(AbortSignal),
		);
		const state = useMultiChatStore.getState();
		expect(state.streaming).toBe(false);
		expect(state.segments).toEqual([]);
		expect(state.messages.map((item) => item.id)).toEqual([
			"turn-1",
			"assistant-a",
			"assistant-b",
		]);
	});

	it("rolls the reply mode back when the Engine rejects the update", async () => {
		useMultiChatStore.setState({
			activeId: "group-1",
			replyMode: "sequential",
		});
		updateModeMock.mockRejectedValue(new Error("unsupported reply_mode"));

		await useMultiChatStore.getState().setReplyMode("smart");

		expect(useMultiChatStore.getState().replyMode).toBe("sequential");
	});

	it("creates a group and opens it", async () => {
		const created = conversation("group-new");
		createMock.mockResolvedValue(created);
		listMock.mockResolvedValue({ conversations: [created], total: 1 });
		getMock.mockResolvedValue({ ...created, messages: [], summary: null });

		const id = await useMultiChatStore
			.getState()
			.createGroup("小队", "sequential", [
				{ character_id: "char-a" },
				{ character_id: "char-b", provider: "openai", model: "gpt-test" },
			]);

		expect(id).toBe("group-new");
		expect(createMock).toHaveBeenCalledWith("小队", "sequential", [
			{ character_id: "char-a" },
			{ character_id: "char-b", provider: "openai", model: "gpt-test" },
		]);
		expect(useMultiChatStore.getState().activeId).toBe("group-new");
	});
});
