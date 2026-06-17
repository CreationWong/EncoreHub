import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
vi.mock("./api", () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import {
	createConversation,
	deleteConversation,
	getConversation,
	listConversations,
	renameConversation,
} from "./conversation";

beforeEach(() => apiFetch.mockReset().mockResolvedValue(undefined));

describe("conversation service", () => {
	it("listConversations -> GET /conversations", async () => {
		await listConversations();
		expect(apiFetch).toHaveBeenCalledWith("/conversations");
	});

	it("getConversation interpolates the id", async () => {
		await getConversation("abc-123");
		expect(apiFetch).toHaveBeenCalledWith("/conversations/abc-123");
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
});
