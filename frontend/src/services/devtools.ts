// Thin wrapper over the Tauri commands that power the developer panel
// (service status + unified logs). Everything is guarded by `inTauri()` so the
// app still runs in a plain browser (Vite dev / vitest), where these commands
// don't exist — callers get empty data instead of a thrown "not in Tauri".

import { apiFetch } from "./api";

export type LogSource = "engine" | "gateway" | "desktop" | "frontend";
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

export interface DatabaseTable {
	name: string;
	columns: string[];
	row_count: number;
}

export interface DatabaseOverview {
	path: string;
	tables: DatabaseTable[];
}

export interface DatabasePage {
	table: string;
	columns: string[];
	rows: Array<Array<string | null>>;
	total_rows: number;
	limit: number;
	offset: number;
}

/** True when running inside the Tauri webview (vs. a plain browser). */
export function inTauri(): boolean {
	return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invokeCommand<T>(
	command: string,
	args?: Record<string, unknown>,
): Promise<T> {
	const { invoke } = await import("@tauri-apps/api/core");
	return invoke<T>(command, args);
}

export const devtools = {
	async status(): Promise<ServiceStatus[]> {
		if (!inTauri()) return [];
		return invokeCommand<ServiceStatus[]>("get_service_status");
	},

	/** Pull all log lines after `after` (0 = from the start of the buffer). */
	async logs(after: number): Promise<LogEntry[]> {
		if (!inTauri()) return [];
		return invokeCommand<LogEntry[]>("get_logs", { after });
	},

	async clear(): Promise<void> {
		if (!inTauri()) return;
		await invokeCommand("clear_logs");
	},

	/** Export the currently visible log entries through the native filesystem. */
	async exportLogs(entries: LogEntry[]): Promise<string | null> {
		if (!inTauri()) return null;
		return invokeCommand<string>("export_logs", { entries });
	},

	/** Open the active on-disk log directory in the platform file manager. */
	async openLogDirectory(): Promise<string | null> {
		if (!inTauri()) return null;
		return invokeCommand<string>("open_log_directory");
	},

	/** Open the native webview DevTools (inspector). No-op outside Tauri. */
	async openDevtools(): Promise<void> {
		if (!inTauri()) return;
		await invokeCommand("open_devtools");
	},

	async getDeveloperMode(): Promise<boolean> {
		if (!inTauri()) return false;
		return invokeCommand<boolean>("get_developer_mode");
	},

	async setDeveloperMode(enabled: boolean): Promise<boolean> {
		if (!inTauri()) return enabled;
		return invokeCommand<boolean>("set_developer_mode", { enabled });
	},

	async restartService(service: "engine" | "gateway"): Promise<ServiceStatus> {
		if (!inTauri()) {
			throw new Error("Service restart is only available in the desktop app");
		}
		return invokeCommand<ServiceStatus>(`restart_${service}`);
	},

	async databaseOverview(): Promise<DatabaseOverview> {
		if (!inTauri()) return { path: "", tables: [] };
		return invokeCommand<DatabaseOverview>("get_database_overview");
	},

	async databaseRows(
		table: string,
		limit: number,
		offset: number,
	): Promise<DatabasePage> {
		if (!inTauri()) {
			return { table, columns: [], rows: [], total_rows: 0, limit, offset };
		}
		return invokeCommand<DatabasePage>("get_database_rows", {
			table,
			limit,
			offset,
		});
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

	async getFileLogLevel(): Promise<LogLevel> {
		if (!inTauri()) return "info";
		return invokeCommand<LogLevel>("get_file_log_level");
	},

	async setFileLogLevel(level: LogLevel): Promise<LogLevel> {
		if (!inTauri()) return level;
		return invokeCommand<LogLevel>("set_file_log_level", { level });
	},

	async clientLog(level: LogLevel, message: string): Promise<void> {
		if (!inTauri() || !message) return;
		await invokeCommand("write_client_log", { level, message });
	},
};

let consoleBridgeInstalled = false;

export function installClientLogBridge(): void {
	if (consoleBridgeInstalled || !inTauri()) return;
	consoleBridgeInstalled = true;

	const original = {
		debug: console.debug.bind(console),
		error: console.error.bind(console),
		info: console.info.bind(console),
		log: console.log.bind(console),
		warn: console.warn.bind(console),
	};

	// Re-entrancy guard — when the bridge itself triggers a console call (e.g.
	// invoke failure), skip forwarding to avoid an infinite error loop.
	let forwarding = false;

	const forward = (level: LogLevel, args: unknown[]) => {
		if (forwarding) return;
		const message = formatConsoleArgs(args);
		if (!message) return;
		forwarding = true;
		void devtools.clientLog(level, message).finally(() => {
			forwarding = false;
		});
	};

	console.debug = (...args: unknown[]) => {
		original.debug(...args);
		forward("debug", args);
	};
	console.error = (...args: unknown[]) => {
		original.error(...args);
		forward("error", args);
	};
	console.info = (...args: unknown[]) => {
		original.info(...args);
		forward("info", args);
	};
	console.log = (...args: unknown[]) => {
		original.log(...args);
		forward("info", args);
	};
	console.warn = (...args: unknown[]) => {
		original.warn(...args);
		forward("warn", args);
	};

	window.addEventListener("error", (event) => {
		forward("error", [
			event.message,
			event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : "",
			event.error,
		]);
	});
	window.addEventListener("unhandledrejection", (event) => {
		forward("error", ["Unhandled promise rejection", event.reason]);
	});
}

function formatConsoleArgs(args: unknown[]): string {
	return args.map(formatConsoleValue).filter(Boolean).join(" ");
}

function formatConsoleValue(value: unknown): string {
	if (typeof value === "string") return value;
	if (value instanceof Error) {
		return value.stack || `${value.name}: ${value.message}`;
	}
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
}
