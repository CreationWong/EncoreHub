import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock config so we can flip AUTH_TOKEN per test by re-importing the module.
const mockConfig = vi.hoisted(() => ({
	AUTH_TOKEN: "",
	API_BASE: "http://test/api/v1",
}));

vi.mock("./config", () => mockConfig);

const fetchSpy = vi.fn();
beforeEach(() => {
	mockConfig.AUTH_TOKEN = "";
	fetchSpy.mockReset();
	vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

async function freshApi() {
	// Re-import api.ts so it reads the current mockConfig.AUTH_TOKEN.
	vi.resetModules();
	return await import("./api");
}

describe("buildHeaders", () => {
	it("does not set Authorization when AUTH_TOKEN is empty", async () => {
		mockConfig.AUTH_TOKEN = "";
		const { buildHeaders } = await freshApi();
		const h = buildHeaders() as Record<string, string>;
		expect(h["Content-Type"]).toBe("application/json");
		expect(h.Authorization).toBeUndefined();
	});

	it("injects Bearer when AUTH_TOKEN is set", async () => {
		mockConfig.AUTH_TOKEN = "tok-abc";
		const { buildHeaders } = await freshApi();
		const h = buildHeaders() as Record<string, string>;
		expect(h.Authorization).toBe("Bearer tok-abc");
	});

	it("merges per-call headers without dropping Authorization", async () => {
		mockConfig.AUTH_TOKEN = "tok-abc";
		const { buildHeaders } = await freshApi();
		const h = buildHeaders({ "X-Provider-Key": "sk-xxx" }) as Record<
			string,
			string
		>;
		expect(h.Authorization).toBe("Bearer tok-abc");
		expect(h["X-Provider-Key"]).toBe("sk-xxx");
	});
});

describe("apiFetch", () => {
	it("prepends API_BASE and parses JSON on success", async () => {
		fetchSpy.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: async () => ({ hello: "world" }),
		} as Response);

		const { apiFetch } = await freshApi();
		const out = await apiFetch<{ hello: string }>("/things");
		expect(out).toEqual({ hello: "world" });

		const calledUrl = fetchSpy.mock.calls[0][0];
		expect(calledUrl).toBe("http://test/api/v1/things");
	});

	it("returns undefined on 204 (no content)", async () => {
		fetchSpy.mockResolvedValueOnce({
			ok: true,
			status: 204,
			json: async () => {
				throw new Error("body should not be parsed");
			},
		} as Response);

		const { apiFetch } = await freshApi();
		const out = await apiFetch<unknown>("/things/1", { method: "DELETE" });
		expect(out).toBeUndefined();
	});

	it("throws ApiError with parsed json error message", async () => {
		// Two mocks: one for the rejects.toMatchObject call, one for the
		// instanceof assertion that follows.
		const errResp = {
			ok: false,
			status: 401,
			text: async () => `{"error":"unauthorized"}`,
		} as Response;
		fetchSpy.mockResolvedValueOnce(errResp);
		fetchSpy.mockResolvedValueOnce(errResp);

		const { apiFetch, ApiError } = await freshApi();
		await expect(apiFetch("/things")).rejects.toMatchObject({
			status: 401,
			message: "unauthorized",
		});
		try {
			await apiFetch("/things");
			throw new Error("should have thrown");
		} catch (e) {
			expect(e).toBeInstanceOf(ApiError);
		}
	});

	it("ApiError falls back to raw body when not JSON", async () => {
		fetchSpy.mockReset();
		fetchSpy.mockResolvedValue({
			ok: false,
			status: 500,
			text: async () => "boom",
		} as Response);

		const { apiFetch } = await freshApi();
		await expect(apiFetch("/things")).rejects.toMatchObject({
			status: 500,
			message: "boom",
		});
	});
});
