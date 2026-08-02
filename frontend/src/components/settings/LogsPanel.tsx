import {
	Bug,
	Download,
	FolderOpen,
	ShieldCheck,
	Trash2,
	TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type LogEntry,
	type LogLevel,
	type LogSource,
	devtools,
	inTauri,
} from "../../services/devtools";
import { confirm } from "../../stores/confirmStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { toast } from "../../stores/toastStore";

const POLL_MS = 1500;
const MAX_RENDERED = 2000;
const SOURCES: LogSource[] = ["engine", "gateway", "desktop", "frontend"];
const LEVELS: LogLevel[] = ["error", "warn", "info", "debug"];
type ActivityScope = "all" | "communication" | "database";

const LEVEL_STYLES: Record<LogLevel, string> = {
	error: "text-danger",
	warn: "text-warning",
	info: "text-text-secondary",
	debug: "text-text-muted",
};

export default function LogsPanel() {
	const fullCommunicationLogs = useSettingsStore(
		(state) => state.fullCommunicationLogs,
	);
	const setFullCommunicationLogs = useSettingsStore(
		(state) => state.setFullCommunicationLogs,
	);
	const [changingCapture, setChangingCapture] = useState(false);
	const [logs, setLogs] = useState<LogEntry[]>([]);
	const [activityScope, setActivityScope] = useState<ActivityScope>("all");
	const [sourceFilter, setSourceFilter] = useState<LogSource | "all">("all");
	const [levelFilter, setLevelFilter] = useState<LogLevel | "all">("all");
	const [query, setQuery] = useState("");
	const [follow, setFollow] = useState(true);
	const [logLevel, setLogLevelState] = useState<LogLevel>("info");
	const [fileLogLevel, setFileLogLevelState] = useState<LogLevel>("info");
	const cursor = useRef(0);
	const scrollRef = useRef<HTMLDivElement>(null);
	const tauri = inTauri();

	useEffect(() => {
		Promise.allSettled([
			devtools.getLogLevel(),
			devtools.getFileLogLevel(),
		]).then(([runtime, file]) => {
			if (runtime.status === "fulfilled") setLogLevelState(runtime.value);
			if (file.status === "fulfilled") setFileLogLevelState(file.value);
		});
	}, []);

	useEffect(() => {
		if (!tauri) return;
		let alive = true;
		const tick = async () => {
			try {
				const fresh = await devtools.logs(cursor.current);
				if (!alive || fresh.length === 0) return;
				cursor.current = fresh[fresh.length - 1].seq;
				setLogs((previous) => {
					const next = [...previous, ...fresh];
					return next.length > MAX_RENDERED
						? next.slice(next.length - MAX_RENDERED)
						: next;
				});
			} catch {
				/* A later poll retries transient desktop IPC failures. */
			}
		};

		void tick();
		const interval = window.setInterval(() => void tick(), POLL_MS);
		return () => {
			alive = false;
			window.clearInterval(interval);
		};
	}, [tauri]);

	useEffect(() => {
		if (follow && logs.length > 0 && scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [follow, logs.length]);

	const filtered = useMemo(() => {
		const normalizedQuery = query.trim().toLowerCase();
		return logs.filter((entry) => {
			const message = entry.message.toLowerCase();
			if (
				activityScope === "communication" &&
				!message.includes("communication")
			) {
				return false;
			}
			if (activityScope === "database" && !message.includes("database/")) {
				return false;
			}
			if (sourceFilter !== "all" && entry.source !== sourceFilter) return false;
			if (levelFilter !== "all" && entry.level !== levelFilter) return false;
			if (normalizedQuery && !message.includes(normalizedQuery)) return false;
			return true;
		});
	}, [activityScope, levelFilter, logs, query, sourceFilter]);

	const toggleFullCommunicationLogs = async () => {
		const next = !fullCommunicationLogs;
		if (next) {
			const accepted = await confirm.ask(
				"Enable full communication logging?",
				"Request and response bodies will be written to local memory and log files. Authentication headers remain redacted. Disable this setting after diagnosis.",
			);
			if (!accepted) return;
		}

		setChangingCapture(true);
		try {
			const applied = await devtools.setFullCommunicationLogs(next);
			setFullCommunicationLogs(applied);
			toast.success(
				applied
					? "Full communication logging enabled"
					: "Restricted logging restored",
			);
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: "Failed to change communication logging",
			);
		} finally {
			setChangingCapture(false);
		}
	};

	const changeLogLevel = useCallback(async (level: LogLevel) => {
		setLogLevelState(level);
		try {
			await devtools.setLogLevel(level);
			toast.success(`Log level set to ${level}`);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to set log level",
			);
		}
	}, []);

	const changeFileLogLevel = useCallback(
		async (level: LogLevel) => {
			if (level === "debug" && fileLogLevel !== "debug") {
				const accepted = await confirm.ask(
					"Enable debug file logs?",
					"DEBUG will write high-volume logs to disk and may make log files grow quickly.",
				);
				if (!accepted) return;
			}

			const previous = fileLogLevel;
			setFileLogLevelState(level);
			try {
				const applied = await devtools.setFileLogLevel(level);
				setFileLogLevelState(applied);
				toast.success(`File log level set to ${applied}`);
			} catch (error) {
				setFileLogLevelState(previous);
				toast.error(
					error instanceof Error
						? error.message
						: "Failed to set file log level",
				);
			}
		},
		[fileLogLevel],
	);

	const clearLogs = useCallback(async () => {
		try {
			await devtools.clear();
			setLogs([]);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to clear logs",
			);
		}
	}, []);

	const exportLogs = useCallback(async () => {
		if (filtered.length === 0) {
			toast.info("No logs to export");
			return;
		}
		try {
			const path = await devtools.exportLogs(filtered);
			if (path) toast.success(`Logs exported to ${path}`);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to export logs",
			);
		}
	}, [filtered]);

	if (!tauri) {
		return (
			<p className="p-10 text-center text-sm text-text-muted">
				Logs are only available in the desktop app.
			</p>
		);
	}

	const CaptureIcon = fullCommunicationLogs ? TriangleAlert : ShieldCheck;

	return (
		<div className="flex h-full min-h-0 flex-col gap-4 p-5">
			<section
				aria-label="Communication logging mode"
				className={`flex items-start gap-3 border-y px-3 py-3 ${
					fullCommunicationLogs
						? "border-warning/40 bg-warning/5"
						: "border-success/30 bg-success/5"
				}`}
			>
				<CaptureIcon
					className={`mt-0.5 h-4 w-4 shrink-0 ${fullCommunicationLogs ? "text-warning" : "text-success"}`}
				/>
				<div className="min-w-0 flex-1">
					<p className="text-xs font-semibold text-text-primary">
						{fullCommunicationLogs
							? "Full communication logging"
							: "Restricted logging"}
					</p>
					<p className="mt-1 text-[11px] leading-5 text-text-muted">
						{fullCommunicationLogs
							? "Request and response bodies are retained locally; authentication headers remain redacted."
							: "Service events and communication metadata are recorded with bodies and credentials redacted."}
					</p>
				</div>
				<button
					type="button"
					role="switch"
					aria-checked={fullCommunicationLogs}
					aria-label="Full communication logging"
					disabled={changingCapture}
					onClick={() => void toggleFullCommunicationLogs()}
					className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
						fullCommunicationLogs ? "bg-warning" : "bg-surface-hover"
					} disabled:cursor-wait disabled:opacity-50`}
				>
					<span
						aria-hidden="true"
						className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
							fullCommunicationLogs ? "translate-x-5" : "translate-x-1"
						}`}
					/>
				</button>
			</section>

			<div className="flex flex-wrap items-center gap-3">
				<label className="flex items-center gap-2">
					<span className="text-xs font-medium text-text-secondary">
						Runtime level
					</span>
					<select
						value={logLevel}
						onChange={(event) =>
							void changeLogLevel(event.target.value as LogLevel)
						}
						aria-label="Set runtime log level"
						className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-text-secondary"
					>
						{LEVELS.map((level) => (
							<option key={level} value={level}>
								{level}
							</option>
						))}
					</select>
				</label>
				<label className="flex items-center gap-2">
					<span className="text-xs font-medium text-text-secondary">
						File level
					</span>
					<select
						value={fileLogLevel}
						onChange={(event) =>
							void changeFileLogLevel(event.target.value as LogLevel)
						}
						aria-label="Set file log level"
						className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-text-secondary"
					>
						{LEVELS.map((level) => (
							<option key={level} value={level}>
								{level}
							</option>
						))}
					</select>
				</label>
			</div>

			<div className="flex flex-wrap items-center gap-2">
				<select
					value={activityScope}
					onChange={(event) =>
						setActivityScope(event.target.value as ActivityScope)
					}
					aria-label="Filter by activity type"
					className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-text-secondary"
				>
					<option value="all">All activity</option>
					<option value="communication">Communication</option>
					<option value="database">Database reads/writes</option>
				</select>
				<select
					value={sourceFilter}
					onChange={(event) =>
						setSourceFilter(event.target.value as LogSource | "all")
					}
					aria-label="Filter by source"
					className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-text-secondary"
				>
					<option value="all">All sources</option>
					{SOURCES.map((source) => (
						<option key={source} value={source}>
							{source}
						</option>
					))}
				</select>
				<select
					value={levelFilter}
					onChange={(event) =>
						setLevelFilter(event.target.value as LogLevel | "all")
					}
					aria-label="Filter by level"
					className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-text-secondary"
				>
					<option value="all">All levels</option>
					{LEVELS.map((level) => (
						<option key={level} value={level}>
							{level}
						</option>
					))}
				</select>
				<input
					autoComplete="off"
					type="search"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder="Search logs..."
					aria-label="Search logs"
					className="min-w-36 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-xs text-text-primary placeholder:text-text-muted"
				/>
				<label className="flex items-center gap-1.5 text-xs text-text-muted">
					<input
						autoComplete="off"
						type="checkbox"
						checked={follow}
						onChange={(event) => setFollow(event.target.checked)}
					/>
					Follow
				</label>
				<button
					type="button"
					onClick={() => void devtools.openDevtools()}
					aria-label="Open DevTools"
					title="Open DevTools"
					className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-primary"
				>
					<Bug className="h-4 w-4" />
				</button>
				<button
					type="button"
					onClick={() => void devtools.openLogDirectory()}
					aria-label="Open log folder"
					title="Open log folder"
					className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-primary"
				>
					<FolderOpen className="h-4 w-4" />
				</button>
				<button
					type="button"
					onClick={() => void exportLogs()}
					disabled={filtered.length === 0}
					aria-label="Export logs"
					title="Export logs"
					className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
				>
					<Download className="h-4 w-4" />
				</button>
				<button
					type="button"
					onClick={() => void clearLogs()}
					aria-label="Clear logs"
					title="Clear logs"
					className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-danger"
				>
					<Trash2 className="h-4 w-4" />
				</button>
			</div>

			<div
				ref={scrollRef}
				className="min-h-48 flex-1 overflow-y-auto rounded-md border border-border bg-surface-alt/30 p-2 font-mono text-[11px] leading-relaxed"
			>
				{filtered.length === 0 ? (
					<p className="py-10 text-center text-text-muted">No log lines.</p>
				) : (
					filtered.map((entry) => (
						<div
							key={entry.seq}
							className="flex gap-2 whitespace-pre-wrap break-all"
						>
							<span className="shrink-0 text-text-muted">[{entry.source}]</span>
							<span
								className={`shrink-0 uppercase ${LEVEL_STYLES[entry.level]}`}
							>
								{entry.level}
							</span>
							<span className="text-text-secondary">{entry.message}</span>
						</div>
					))
				)}
			</div>
		</div>
	);
}
