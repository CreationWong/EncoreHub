import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	Conversation,
	ConversationParticipant,
	Message,
} from "../services/conversation";
import type { GroupEventCallbacks } from "../services/groupChat";

vi.mock("../services/conversation", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../services/conversation")>();
	return {
		...actual,
		listConversations: vi.fn(),
		getConversation: vi.fn(),
		createGroupConversation: vi.fn(),
		updateConversationReplyMode: vi.fn(),
		updateConversationGroupSettings: vi.fn(),
		deleteConversation: vi.fn(),
	};
});

vi.mock("../services/groupChat", () => ({
	enqueueGroupMessage: vi.fn(),
	subscribeGroupEvents: vi.fn(),
}));

import {
	createGroupConversation,
	getConversation,
	listConversations,
	updateConversationGroupSettings,
	updateConversationReplyMode,
} from "../services/conversation";
import {
	enqueueGroupMessage,
	subscribeGroupEvents,
} from "../services/groupChat";
import { useMultiChatStore } from "./multiChatStore";

const listMock = vi.mocked(listConversations);
const getMock = vi.mocked(getConversation);
const createMock = vi.mocked(createGroupConversation);
const updateModeMock = vi.mocked(updateConversationReplyMode);
const updateSettingsMock = vi.mocked(updateConversationGroupSettings);
const enqueueMock = vi.mocked(enqueueGroupMessage);
const subscribeMock = vi.mocked(subscribeGroupEvents);

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
	subscribeMock.mockImplementation(async () => new Promise<void>(() => {}));
	useMultiChatStore.setState({
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

	it("enqueues a user message and folds runner events into the transcript", async () => {
		const streaming = conversation("group-1", {
			group_settings: {
				auto_chat_enabled: true,
				max_auto_turns: 6,
				allow_bot_mentions: true,
				paused: false,
				user_persona: { name: "我", avatar: "", description: "" },
			},
		});
		getMock.mockResolvedValue({
			...streaming,
			messages: [],
			summary: null,
			summary_start_message_id: null,
			summary_end_message_id: null,
		});
		enqueueMock.mockResolvedValue({
			user_message: message({
				id: "turn-1",
				role: "user",
				content: "开始",
			}),
			queued: 1,
			command: null,
		});

		await useMultiChatStore.getState().openConversation("group-1");
		expect(subscribeMock).toHaveBeenCalledWith(
			"group-1",
			expect.any(Object),
			expect.any(AbortSignal),
		);
		const callbacks = subscribeMock.mock.calls[0][1] as GroupEventCallbacks;

		await useMultiChatStore.getState().sendMessage("开始", ["char-a"]);
		expect(enqueueMock).toHaveBeenCalledWith("group-1", "开始", ["char-a"]);
		let state = useMultiChatStore.getState();
		expect(state.messages.map((item) => item.id)).toEqual(["turn-1"]);
		expect(state.runnerState).toBe("running");

		callbacks.onRunnerState?.({ state: "running", pending: 1 });
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
		callbacks.onMessageAppended?.(
			message({
				id: "assistant-a",
				content: "A 收到",
				sender_character_id: "char-a",
			}),
		);
		callbacks.onRunnerState?.({ state: "idle", pending: 0 });

		state = useMultiChatStore.getState();
		expect(state.messages.map((item) => item.id)).toEqual([
			"turn-1",
			"assistant-a",
		]);
		expect(state.segments).toEqual([]);
		expect(state.runnerState).toBe("idle");
	});

	it("sends the user-only stop command through the enqueue endpoint", async () => {
		useMultiChatStore.setState({ activeId: "group-1" });
		enqueueMock.mockResolvedValue({ command: "stop", queued: 0 });

		await useMultiChatStore.getState().stopStreaming();

		expect(enqueueMock).toHaveBeenCalledWith("group-1", "/stop", []);
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
		getMock.mockResolvedValue({
			...created,
			messages: [],
			summary: null,
			summary_start_message_id: null,
			summary_end_message_id: null,
		});

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
		expect(updateSettingsMock).not.toHaveBeenCalled();
		expect(useMultiChatStore.getState().activeId).toBe("group-new");
	});
});
