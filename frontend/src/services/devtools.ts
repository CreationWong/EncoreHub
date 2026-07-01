// Thin wrapper over the Tauri commands that power the developer panel
// (service status + sidecar logs). Everything is guarded by `inTauri()` so the
// app still runs in a plain browser (Vite dev / vitest), where these commands
// don't exist — callers get empty data instead of a thrown "not in Tauri".

import { invoke } from "@tauri-apps/api/core";
import { apiFetch } from "./api";

export type LogSource = "engine" | "gateway" | "desktop";
export type LogLevel = "error" | "warn" | "info" | "debug";

export interface LogEntry {
	seq: number;
	source: LogSource;
	level: LogLevel;
	message: string;
}

export interface ServiceStatus {
	name: string;
	pid: number | null;
	running: boolean;
	uptime_secs: number;
	port: number;
}

/** True when running inside the Tauri webview (vs. a plain browser). */
export function inTauri(): boolean {
	return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export const devtools = {
	async status(): Promise<ServiceStatus[]> {
		if (!inTauri()) return [];
		return invoke<ServiceStatus[]>("get_service_status");
	},

	/** Pull all log lines after `after` (0 = from the start of the buffer). */
	async logs(after: number): Promise<LogEntry[]> {
		if (!inTauri()) return [];
		return invoke<LogEntry[]>("get_logs", { after });
	},

	async clear(): Promise<void> {
		if (!inTauri()) return;
		await invoke("clear_logs");
	},

	/** Open the native webview DevTools (inspector). No-op outside Tauri. */
	async openDevtools(): Promise<void> {
		if (!inTauri()) return;
		await invoke("open_devtools");
	},

	/**
	 * Read the current persisted log level via the gateway (which reads it from
	 * the engine's config). Works in or out of Tauri since it's an HTTP call.
	 */
	async getLogLevel(): Promise<LogLevel> {
		const res = await apiFetch<{ level: LogLevel }>("/log-level");
		return res.level;
	},

	/**
	 * Set the runtime log level for both gateway and engine. The gateway applies
	 * its own level immediately and persists to the engine's config, which the
	 * engine applies via its reload layer.
	 */
	async setLogLevel(level: LogLevel): Promise<void> {
		await apiFetch<{ level: LogLevel }>("/log-level", {
			method: "POST",
			body: JSON.stringify({ level }),
		});
	},
};
