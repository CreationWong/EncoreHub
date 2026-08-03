import { invoke } from "@tauri-apps/api/core";

const MAX_CAPTURED_BODY_CHARS = 512 * 1024;
const SENSITIVE_HEADER_PARTS = [
	"authorization",
	"api-key",
	"apikey",
	"token",
	"secret",
	"cookie",
	"subscription-key",
];

function diagnosticsAvailable(): boolean {
	return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function diagnosticsEnabled(): boolean {
	return (
		diagnosticsAvailable() &&
		localStorage.getItem("encorehub-full-communication-logs") === "1"
	);
}

function sensitiveName(name: string): boolean {
	const normalized = name.toLowerCase();
	return (
		normalized === "key" ||
		normalized.endsWith("-key") ||
		normalized.endsWith("_key") ||
		SENSITIVE_HEADER_PARTS.some((part) => normalized.includes(part))
	);
}

function sanitizedHeaders(headers?: HeadersInit): Record<string, string> {
	const result: Record<string, string> = {};
	if (!headers) return result;
	for (const [name, value] of new Headers(headers).entries()) {
		result[name] = sensitiveName(name) ? "[redacted]" : value;
	}
	return result;
}

function capturedBody(body: BodyInit | null | undefined): {
	content: string;
	truncated: boolean;
} {
	if (body == null) return { content: "", truncated: false };
	const content =
		typeof body === "string" ? body : `[${body.constructor.name}]`;
	return {
		content: content.slice(0, MAX_CAPTURED_BODY_CHARS),
		truncated: content.length > MAX_CAPTURED_BODY_CHARS,
	};
}

async function writeTrace(payload: Record<string, unknown>): Promise<void> {
	try {
		await invoke("write_client_log", {
			level: "info",
			message: `[communication] ${JSON.stringify(payload)}`,
		});
	} catch {
		// Diagnostics must never alter the request that is being observed.
	}
}

export async function diagnosticFetch(
	input: RequestInfo | URL,
	init: RequestInit = {},
): Promise<Response> {
	if (!diagnosticsAvailable()) return fetch(input, init);

	const url = typeof input === "string" ? input : input.toString();
	const method = init.method?.toUpperCase() ?? "GET";
	const fullCapture = diagnosticsEnabled();
	const requestTrace: Record<string, unknown> = {
		direction: "frontend-request",
		method,
		url,
	};
	if (fullCapture) {
		const requestBody = capturedBody(init.body);
		requestTrace.headers = sanitizedHeaders(init.headers);
		requestTrace.body = requestBody.content;
		requestTrace.body_truncated = requestBody.truncated;
	}
	void writeTrace(requestTrace);

	const started = performance.now();
	try {
		const response = await fetch(input, init);
		const responseTrace: Record<string, unknown> = {
			direction: "frontend-response",
			method,
			url,
			status: response.status,
			duration_ms: Math.round(performance.now() - started),
		};
		if (fullCapture) {
			const copy = response.clone();
			void copy
				.text()
				.then((body) => {
					const captured = capturedBody(body);
					return writeTrace({
						...responseTrace,
						headers: sanitizedHeaders(response.headers),
						body: captured.content,
						body_truncated: captured.truncated,
					});
				})
				.catch(() => undefined);
		} else {
			void writeTrace(responseTrace);
		}
		return response;
	} catch (error) {
		void writeTrace({
			direction: "frontend-response",
			method,
			url,
			duration_ms: Math.round(performance.now() - started),
			error: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
}

export const diagnosticFetchInternals = {
	capturedBody,
	diagnosticsAvailable,
	diagnosticsEnabled,
	sanitizedHeaders,
};
