import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { diagnosticFetchInternals } from "./diagnosticFetch";

describe("diagnosticFetch", () => {
	beforeEach(() => {
		localStorage.clear();
		Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
	});

	afterEach(() => {
		localStorage.clear();
		Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
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
});
