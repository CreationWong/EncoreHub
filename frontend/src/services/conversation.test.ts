import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
vi.mock("./api", () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import {
	createConversation,
	deleteConversation,
	generateTitle,
	getConversation,
	listConversations,
	renameConversation,
	updateConversationModel,
} from "./conversation";

beforeEach(() => apiFetch.mockReset().mockResolvedValue(undefined));

describe("conversation service", () => {
	it("listConversations -> GET /conversations", async () => {
		await listConversations();
		expect(apiFetch).toHaveBeenCalledWith("/conversations");
	});

	it("getConversation interpolates the id", async () => {
		apiFetch.mockResolvedValueOnce({ messages: [] });
		await getConversation("abc-123");
		expect(apiFetch).toHaveBeenCalledWith("/conversations/abc-123");
	});

	it("normalizes omitted and null tool calls in conversation messages", async () => {
		apiFetch.mockResolvedValueOnce({
			id: "c1",
			title: "Legacy conversation",
			provider: "openai",
			model: "gpt-4o",
			messages: [
				{
					id: "m1",
					role: "assistant",
					content: "omitted",
					parent_id: null,
					status: "completed",
					created_at: "",
				},
				{
					id: "m2",
					role: "assistant",
					content: "null",
					parent_id: null,
					tool_calls: null,
					status: "completed",
					created_at: "",
				},
			],
			summary: null,
			created_at: "",
			updated_at: "",
		});

		const detail = await getConversation("c1");

		expect(detail.messages.map((message) => message.tool_calls)).toEqual([
			[],
			[],
		]);
	});

	it("removes duplicated DSML protocol blocks from historical tool messages", async () => {
		const dsml =
			'<|DSML|><|tool_calls|><|DSML|><|invoke name="web_search"><|DSML|><|parameter name="query" string="true">world population</|DSML|></|invoke></|tool_calls>';
		apiFetch.mockResolvedValueOnce({
			id: "c1",
			title: "Tool conversation",
			provider: "deepseek",
			model: "deepseek-chat",
			messages: [
				{
					id: "m1",
					role: "assistant",
					content: `${dsml}\n\nThe requested population table is ready.`,
					parent_id: null,
					tool_calls: [
						{
							id: "call-1",
							name: "web_search",
							arguments: '{"query":"world population"}',
						},
					],
					status: "completed",
					created_at: "",
				},
			],
			summary: null,
			created_at: "",
			updated_at: "",
		});

		const detail = await getConversation("c1");

		expect(detail.messages[0].content).toBe(
			"The requested population table is ready.",
		);
	});

	it("preserves ordinary DSML discussion without structured tool calls", async () => {
		const content =
			"The literal <|DSML|><|tool_calls|> marker is part of this explanation.";
		apiFetch.mockResolvedValueOnce({
			id: "c1",
			title: "Protocol discussion",
			provider: "deepseek",
			model: "deepseek-chat",
			messages: [
				{
					id: "m1",
					role: "assistant",
					content,
					parent_id: null,
					tool_calls: [],
					status: "completed",
					created_at: "",
				},
			],
			summary: null,
			created_at: "",
			updated_at: "",
		});

		const detail = await getConversation("c1");

		expect(detail.messages[0].content).toBe(content);
	});

	it("createConversation defaults to 'New Chat'", async () => {
		await createConversation();
		const [path, opts] = apiFetch.mock.calls[0];
		expect(path).toBe("/conversations");
		expect(opts.method).toBe("POST");
		expect(JSON.parse(opts.body)).toEqual({
			title: "New Chat",
			provider: "",
			model: "",
		});
	});

	it("createConversation honours explicit title/provider/model", async () => {
		await createConversation("Hi", "openai", "gpt-4o");
		const [, opts] = apiFetch.mock.calls[0];
		expect(JSON.parse(opts.body)).toEqual({
			title: "Hi",
			provider: "openai",
			model: "gpt-4o",
		});
	});

	it("deleteConversation -> DELETE /conversations/:id", async () => {
		await deleteConversation("c1");
		expect(apiFetch).toHaveBeenCalledWith("/conversations/c1", {
			method: "DELETE",
		});
	});

	it("renameConversation -> PATCH with {title}", async () => {
		await renameConversation("c1", "renamed");
		const [path, opts] = apiFetch.mock.calls[0];
		expect(path).toBe("/conversations/c1");
		expect(opts.method).toBe("PATCH");
		expect(JSON.parse(opts.body)).toEqual({ title: "renamed" });
	});

	it("updateConversationModel -> PATCH with provider and model", async () => {
		await updateConversationModel("c1", "anthropic", "claude-sonnet-4");
		const [path, opts] = apiFetch.mock.calls[0];
		expect(path).toBe("/conversations/c1");
		expect(opts.method).toBe("PATCH");
		expect(JSON.parse(opts.body)).toEqual({
			provider: "anthropic",
			model: "claude-sonnet-4",
		});
	});

	it("generateTitle posts force flag and provider key", async () => {
		await generateTitle("c1", "sk-test", true);
		const [path, opts] = apiFetch.mock.calls[0];
		expect(path).toBe("/conversations/c1/generate-title");
		expect(opts.method).toBe("POST");
		expect(opts.headers).toEqual({ "X-Provider-Key": "sk-test" });
		expect(JSON.parse(opts.body)).toEqual({ force: true });
	});

	it("generateTitle defaults force to false", async () => {
		await generateTitle("c1");
		const [, opts] = apiFetch.mock.calls[0];
		expect(JSON.parse(opts.body)).toEqual({ force: false });
	});
});
