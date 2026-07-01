import { Bug, Download, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type LogEntry,
	type LogLevel,
	type LogSource,
	type ServiceStatus,
	devtools,
	inTauri,
} from "../../services/devtools";
import { toast } from "../../stores/toastStore";

const POLL_MS = 1500;
const MAX_RENDERED = 2000;

const LEVEL_STYLES: Record<LogLevel, string> = {
	error: "text-danger",
	warn: "text-warning",
	info: "text-text-secondary",
	debug: "text-text-muted",
};

const SOURCES: LogSource[] = ["engine", "gateway", "desktop"];
const LEVELS: LogLevel[] = ["error", "warn", "info", "debug"];

function uptimeLabel(secs: number): string {
	if (secs <= 0) return "—";
	const h = Math.floor(secs / 3600);
	const m = Math.floor((secs % 3600) / 60);
	const s = secs % 60;
	if (h > 0) return `${h}h ${m}m`;
	if (m > 0) return `${m}m ${s}s`;
	return `${s}s`;
}

function StatusCard({ svc }: { svc: ServiceStatus }) {
	const ok = svc.running;
	return (
		<div className="flex-1 rounded-lg border border-border bg-surface-alt/40 p-3">
			<div className="flex items-center gap-2">
				<span
					className={`h-2 w-2 shrink-0 rounded-full ${ok ? "bg-success" : "bg-danger"}`}
					aria-hidden="true"
				/>
				<span className="text-sm font-medium capitalize text-text-primary">
					{svc.name}
				</span>
				<span
					className={`ml-auto text-[10px] font-medium ${ok ? "text-success" : "text-danger"}`}
				>
					{ok ? "running" : "down"}
				</span>
			</div>
			<dl className="mt-2 space-y-0.5 text-[11px] text-text-muted">
				<div className="flex justify-between">
					<dt>PID</dt>
					<dd className="text-text-secondary">{svc.pid ?? "—"}</dd>
				</div>
				<div className="flex justify-between">
					<dt>Port</dt>
					<dd className="text-text-secondary">{svc.port || "—"}</dd>
				</div>
				<div className="flex justify-between">
					<dt>Uptime</dt>
					<dd className="text-text-secondary">
						{uptimeLabel(svc.uptime_secs)}
					</dd>
				</div>
			</dl>
		</div>
	);
}

export default function DeveloperPanel() {
	const [statuses, setStatuses] = useState<ServiceStatus[]>([]);
	const [logs, setLogs] = useState<LogEntry[]>([]);
	const [sourceFilter, setSourceFilter] = useState<LogSource | "all">("all");
	const [levelFilter, setLevelFilter] = useState<LogLevel | "all">("all");
	const [query, setQuery] = useState("");
	const [follow, setFollow] = useState(true);
	const [logLevel, setLogLevelState] = useState<LogLevel>("info");

	const cursor = useRef(0);
	const scrollRef = useRef<HTMLDivElement>(null);

	const tauri = inTauri();

	// Load the current runtime log level once on mount.
	useEffect(() => {
		devtools
			.getLogLevel()
			.then(setLogLevelState)
			.catch(() => {
				/* gateway not ready; keep default */
			});
	}, []);

	const changeLogLevel = useCallback(async (level: LogLevel) => {
		setLogLevelState(level);
		try {
			await devtools.setLogLevel(level);
			toast.success(`Log level set to ${level}`);
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : "Failed to set log level",
			);
		}
	}, []);

	// Poll status + incremental logs. The cursor (last seen seq) lets us pull
	// only new lines each tick instead of the whole buffer.
	useEffect(() => {
		if (!tauri) return;
		let alive = true;

		const tick = async () => {
			try {
				const [st, fresh] = await Promise.all([
					devtools.status(),
					devtools.logs(cursor.current),
				]);
				if (!alive) return;
				setStatuses(st);
				if (fresh.length > 0) {
					cursor.current = fresh[fresh.length - 1].seq;
					setLogs((prev) => {
						const next = [...prev, ...fresh];
						return next.length > MAX_RENDERED
							? next.slice(next.length - MAX_RENDERED)
							: next;
					});
				}
			} catch {
				/* transient; next tick retries */
			}
		};

		tick();
		const id = setInterval(tick, POLL_MS);
		return () => {
			alive = false;
			clearInterval(id);
		};
	}, [tauri]);

	// Auto-scroll to the newest line while following.
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-run when logs grow
	useEffect(() => {
		if (follow && scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [logs, follow]);

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		return logs.filter((l) => {
			if (sourceFilter !== "all" && l.source !== sourceFilter) return false;
			if (levelFilter !== "all" && l.level !== levelFilter) return false;
			if (q && !l.message.toLowerCase().includes(q)) return false;
			return true;
		});
	}, [logs, sourceFilter, levelFilter, query]);

	const clear = useCallback(async () => {
		try {
			await devtools.clear();
			setLogs([]);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "clear failed");
		}
	}, []);

	const exportLogs = useCallback(() => {
		const text = filtered
			.map((l) => `[${l.source}/${l.level}] ${l.message}`)
			.join("\n");
		const blob = new Blob([text], { type: "text/plain" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "encorehub-logs.txt";
		a.click();
		URL.revokeObjectURL(url);
	}, [filtered]);

	if (!tauri) {
		return (
			<p className="py-10 text-center text-sm text-text-muted">
				Developer tools are only available in the desktop app.
			</p>
		);
	}

	return (
		<div className="flex h-full flex-col space-y-4">
			{/* Status cards */}
			<div className="flex gap-3">
				{statuses.map((s) => (
					<StatusCard key={s.name} svc={s} />
				))}
			</div>

			{/* Runtime log level (applies to engine + gateway immediately) */}
			<div className="flex items-center gap-2">
				<span className="text-xs font-medium text-text-secondary">
					Log level
				</span>
				<select
					value={logLevel}
					onChange={(e) => changeLogLevel(e.target.value as LogLevel)}
					aria-label="Set runtime log level"
					className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-text-secondary"
				>
					{LEVELS.map((l) => (
						<option key={l} value={l}>
							{l}
						</option>
					))}
				</select>
				<span className="text-[11px] text-text-muted">
					applies to engine + gateway
				</span>
			</div>

			{/* Log toolbar */}
			<div className="flex flex-wrap items-center gap-2">
				<select
					value={sourceFilter}
					onChange={(e) => setSourceFilter(e.target.value as LogSource | "all")}
					aria-label="Filter by source"
					className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-text-secondary"
				>
					<option value="all">All sources</option>
					{SOURCES.map((s) => (
						<option key={s} value={s}>
							{s}
						</option>
					))}
				</select>
				<select
					value={levelFilter}
					onChange={(e) => setLevelFilter(e.target.value as LogLevel | "all")}
					aria-label="Filter by level"
					className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-text-secondary"
				>
					<option value="all">All levels</option>
					{LEVELS.map((l) => (
						<option key={l} value={l}>
							{l}
						</option>
					))}
				</select>
				<input
					type="search"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="Search logs…"
					aria-label="Search logs"
					className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-xs text-text-primary placeholder:text-text-muted"
				/>
				<label className="flex items-center gap-1.5 text-xs text-text-muted">
					<input
						type="checkbox"
						checked={follow}
						onChange={(e) => setFollow(e.target.checked)}
					/>
					Follow
				</label>
				<button
					type="button"
					onClick={() =>
						devtools.openDevtools().catch((err) => {
							toast.error(
								err instanceof Error ? err.message : "Failed to open DevTools",
							);
						})
					}
					aria-label="Open DevTools"
					title="Open DevTools (inspector)"
					className="rounded-md p-1.5 text-text-muted hover:bg-surface-hover hover:text-text-primary"
				>
					<Bug className="h-4 w-4" />
				</button>
				<button
					type="button"
					onClick={exportLogs}
					aria-label="Export logs"
					title="Export"
					className="rounded-md p-1.5 text-text-muted hover:bg-surface-hover hover:text-text-primary"
				>
					<Download className="h-4 w-4" />
				</button>
				<button
					type="button"
					onClick={clear}
					aria-label="Clear logs"
					title="Clear"
					className="rounded-md p-1.5 text-text-muted hover:bg-surface-hover hover:text-danger"
				>
					<Trash2 className="h-4 w-4" />
				</button>
			</div>

			{/* Log view */}
			<div
				ref={scrollRef}
				className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-surface-alt/30 p-2 font-mono text-[11px] leading-relaxed"
			>
				{filtered.length === 0 ? (
					<p className="py-10 text-center text-text-muted">No log lines.</p>
				) : (
					filtered.map((l) => (
						<div
							key={l.seq}
							className="flex gap-2 whitespace-pre-wrap break-all"
						>
							<span className="shrink-0 text-text-muted">[{l.source}]</span>
							<span className={`shrink-0 uppercase ${LEVEL_STYLES[l.level]}`}>
								{l.level}
							</span>
							<span className="text-text-secondary">{l.message}</span>
						</div>
					))
				)}
			</div>
		</div>
	);
}
