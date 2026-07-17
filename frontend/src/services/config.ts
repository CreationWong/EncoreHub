// Centralized client config. Override via Vite env vars in .env.local:
//   VITE_GATEWAY_URL=http://127.0.0.1:8080
//   VITE_AUTH_TOKEN=<must match gateway's ENCOREHUB_AUTH_TOKEN>
//
// In Tauri / client mode the ports are negotiated at startup and applied via
// applyServicePorts() before the first API call — the Vite env vars act as
// a fallback for dev mode (non-Tauri).

// ---- runtime-updatable URLs (mutated by applyServicePorts) ----

let _gatewayUrl: string =
	import.meta.env.VITE_GATEWAY_URL ?? "http://127.0.0.1:8080";

export function applyServicePorts(gatewayPort: number): void {
	_gatewayUrl = `http://127.0.0.1:${gatewayPort}`;
}

export function gatewayUrl(): string {
	return _gatewayUrl;
}
export function apiBase(): string {
	return `${_gatewayUrl}/api/v1`;
}

// ---- auth ----

export const AUTH_TOKEN: string = import.meta.env.VITE_AUTH_TOKEN ?? "";

// ---- health endpoints ----

export function gatewayLivenessUrl(): string {
	return `${apiBase()}/health/live`;
}

export function gatewayReadinessUrl(): string {
	return `${apiBase()}/health/ready`;
}
