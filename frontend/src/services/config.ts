// Centralized client config. Override via Vite env vars in .env.local:
//   VITE_GATEWAY_URL=http://127.0.0.1:8080
//   VITE_ENGINE_URL=http://127.0.0.1:3000
//   VITE_AUTH_TOKEN=<must match gateway's ENCOREHUB_AUTH_TOKEN>
//
// In Tauri / client mode the ports are negotiated at startup and applied via
// applyServicePorts() before the first API call — the Vite env vars act as
// a fallback for dev mode (non-Tauri).

// ---- runtime-updatable URLs (mutated by applyServicePorts) ----

let _gatewayUrl: string =
	import.meta.env.VITE_GATEWAY_URL ?? "http://127.0.0.1:8080";
let _engineUrl: string =
	import.meta.env.VITE_ENGINE_URL ?? "http://127.0.0.1:3000";

export function applyServicePorts(gatewayPort: number, enginePort: number): void {
	_gatewayUrl = `http://127.0.0.1:${gatewayPort}`;
	_engineUrl = `http://127.0.0.1:${enginePort}`;
}

export function gatewayUrl(): string {
	return _gatewayUrl;
}
export function engineUrl(): string {
	return _engineUrl;
}
export function apiBase(): string {
	return `${_gatewayUrl}/api/v1`;
}

// ---- auth ----

export const AUTH_TOKEN: string = import.meta.env.VITE_AUTH_TOKEN ?? "";

// ---- health endpoints ----

export function healthGatewayUrl(): string {
	return `${apiBase()}/health`;
}
export function healthEngineUrl(): string {
	return `${_engineUrl}/health`;
}
