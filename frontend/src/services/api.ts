import { API_BASE, AUTH_TOKEN } from "./config";

export class ApiError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
		this.name = "ApiError";
	}
}

function buildHeaders(extra?: HeadersInit): HeadersInit {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (AUTH_TOKEN) {
		headers.Authorization = `Bearer ${AUTH_TOKEN}`;
	}
	if (extra) {
		for (const [k, v] of Object.entries(extra as Record<string, string>)) {
			headers[k] = v;
		}
	}
	return headers;
}

export async function apiFetch<T>(
	path: string,
	options: RequestInit = {},
): Promise<T> {
	const url = `${API_BASE}${path}`;

	const res = await fetch(url, {
		...options,
		headers: buildHeaders(options.headers),
	});

	if (!res.ok) {
		const body = await res.text();
		let msg = body;
		try {
			const json = JSON.parse(body);
			msg = json.error || body;
		} catch {
			// use raw body
		}
		throw new ApiError(res.status, msg);
	}

	if (res.status === 204) return undefined as T;
	return res.json();
}

export { API_BASE, AUTH_TOKEN, buildHeaders };
