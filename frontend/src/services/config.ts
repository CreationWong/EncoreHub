// Centralized client config. Override via Vite env vars in .env.local:
//   VITE_GATEWAY_URL=http://127.0.0.1:8080
//   VITE_ENGINE_URL=http://127.0.0.1:3000
//   VITE_AUTH_TOKEN=<must match gateway's ENCOREHUB_AUTH_TOKEN>

export const GATEWAY_URL: string =
	import.meta.env.VITE_GATEWAY_URL ?? "http://127.0.0.1:8080";

export const ENGINE_URL: string =
	import.meta.env.VITE_ENGINE_URL ?? "http://127.0.0.1:3000";

export const AUTH_TOKEN: string = import.meta.env.VITE_AUTH_TOKEN ?? "";

export const API_BASE = `${GATEWAY_URL}/api/v1`;
export const HEALTH_GATEWAY = `${API_BASE}/health`;
export const HEALTH_ENGINE = `${ENGINE_URL}/health`;
