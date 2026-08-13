/** Contract tests for the configuration-free data-management client. */

import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
vi.mock("./api", () => ({
	apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

import { dataManagementApi } from "./dataManagement";

describe("dataManagementApi", () => {
	beforeEach(() => apiFetch.mockReset());

	it("uses the dedicated data routes and serializes imports", async () => {
		apiFetch.mockResolvedValue({ imported_rows: 1 });
		const backup = {
			schema: "encorehub.user-data" as const,
			version: 1,
			exported_at: "2026-08-12T00:00:00Z",
			tables: {},
			blobs: {},
		};

		await dataManagementApi.exportData(["conversations", "memories"]);
		await dataManagementApi.exportConversations(["c1", "c2"]);
		await dataManagementApi.deleteConversations(["c2"]);
		await dataManagementApi.importData(backup);
		await dataManagementApi.clearHistory();

		expect(apiFetch).toHaveBeenNthCalledWith(
			1,
			"/data/export?domains=conversations,memories",
		);
		expect(apiFetch).toHaveBeenNthCalledWith(2, "/data/conversations/export", {
			method: "POST",
			body: JSON.stringify({ conversation_ids: ["c1", "c2"] }),
		});
		expect(apiFetch).toHaveBeenNthCalledWith(3, "/data/conversations/delete", {
			method: "POST",
			body: JSON.stringify({ conversation_ids: ["c2"] }),
		});
		expect(apiFetch).toHaveBeenNthCalledWith(4, "/data/import", {
			method: "POST",
			body: JSON.stringify(backup),
		});
		expect(apiFetch).toHaveBeenNthCalledWith(5, "/data/conversations", {
			method: "DELETE",
		});
	});
});
