import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { diagnosticFetch, diagnosticFetchInternals } from "./diagnosticFetch";

describe("diagnosticFetch", () => {
	beforeEach(() => {
		localStorage.clear();
		Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
	});

	afterEach(() => {
		localStorage.clear();
		Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
		vi.unstubAllGlobals();
	});

	it("requires both desktop runtime and the explicit full-logging preference", () => {
		localStorage.setItem("encorehub-full-communication-logs", "1");
		expect(diagnosticFetchInternals.diagnosticsEnabled()).toBe(false);

		Object.defineProperty(window, "__TAURI_INTERNALS__", {
			configurable: true,
			value: {},
		});
		expect(diagnosticFetchInternals.diagnosticsEnabled()).toBe(true);
	});

	it("redacts credential headers while preserving diagnostic metadata", () => {
		expect(
			diagnosticFetchInternals.sanitizedHeaders({
				Authorization: "Bearer secret",
				"X-Provider-Key": "secret",
				"X-Request-ID": "request-1",
			}),
		).toEqual({
			authorization: "[redacted]",
			"x-provider-key": "[redacted]",
			"x-request-id": "request-1",
		});
	});

	it("records safe request metadata without full communication capture", async () => {
		Object.defineProperty(window, "__TAURI_INTERNALS__", {
			configurable: true,
			value: {},
		});
		invoke.mockReset().mockResolvedValue(undefined);
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				new Response('{"private":"response"}', { status: 200 }),
			);
		vi.stubGlobal("fetch", fetchMock);

		await diagnosticFetch("https://provider.example/v1/models", {
			method: "POST",
			headers: { Authorization: "Bearer private-key" },
			body: '{"private":"request"}',
		});
		await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));

		const messages = invoke.mock.calls.map(
			([, args]) => (args as { message: string }).message,
		);
		expect(messages.join("\n")).toContain("provider.example/v1/models");
		expect(messages.join("\n")).not.toContain("private-key");
		expect(messages.join("\n")).not.toContain("private-request");
		expect(messages.join("\n")).not.toContain("private-response");
	});
});
