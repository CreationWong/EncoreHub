import {
	Activity,
	Bug,
	ChevronLeft,
	ChevronRight,
	Database,
	Download,
	FolderOpen,
	RefreshCw,
	RotateCcw,
	Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type DatabaseOverview,
	type DatabasePage,
	type LogEntry,
	type LogLevel,
	type LogSource,
	type ServiceStatus,
	devtools,
	inTauri,
} from "../../services/devtools";
import { confirm } from "../../stores/confirmStore";
import { toast } from "../../stores/toastStore";

const POLL_MS = 1500;
const MAX_RENDERED = 2000;
const DATABASE_PAGE_SIZE = 100;

const LEVEL_STYLES: Record<LogLevel, string> = {
	error: "text-danger",
	warn: "text-warning",
	info: "text-text-secondary",
	debug: "text-text-muted",
};

const SOURCES: LogSource[] = ["engine", "gateway", "desktop", "frontend"];
const LEVELS: LogLevel[] = ["error", "warn", "info", "debug"];
type DeveloperView = "activity" | "database";
type ActivityScope = "all" | "communication" | "database";

function uptimeLabel(secs: number): string {
	if (secs <= 0) return "—";
	const h = Math.floor(secs / 3600);
	const m = Math.floor((secs % 3600) / 60);
	const s = secs % 60;
	if (h > 0) return `${h}h ${m}m`;
	if (m > 0) return `${m}m ${s}s`;
	return `${s}s`;
}

function StatusCard({
	svc,
	restarting,
	onRestart,
}: {
	svc: ServiceStatus;
	restarting: boolean;
	onRestart?: () => void;
}) {
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
				<div className="ml-auto flex items-center gap-1.5">
					<span
						className={`text-[10px] font-medium ${ok ? "text-success" : "text-danger"}`}
					>
						{restarting ? "restarting" : ok ? "running" : "down"}
					</span>
					{onRestart && (
						<button
							type="button"
							onClick={onRestart}
							disabled={restarting}
							aria-label={`Restart ${svc.name}`}
							title={`Restart ${svc.name}`}
							className="rounded-md p-1 text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-wait disabled:opacity-50"
						>
							<RotateCcw
								className={`h-3.5 w-3.5 ${restarting ? "animate-spin" : ""}`}
							/>
						</button>
					)}
				</div>
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
	const [view, setView] = useState<DeveloperView>("activity");
	const [statuses, setStatuses] = useState<ServiceStatus[]>([]);
	const [restarting, setRestarting] = useState<"engine" | "gateway" | null>(
		null,
	);
	const [logs, setLogs] = useState<LogEntry[]>([]);
	const [activityScope, setActivityScope] = useState<ActivityScope>("all");
	const [sourceFilter, setSourceFilter] = useState<LogSource | "all">("all");
	const [levelFilter, setLevelFilter] = useState<LogLevel | "all">("all");
	const [query, setQuery] = useState("");
	const [follow, setFollow] = useState(true);
	const [logLevel, setLogLevelState] = useState<LogLevel>("info");
	const [fileLogLevel, setFileLogLevelState] = useState<LogLevel>("info");
	const [databaseOverview, setDatabaseOverview] =
		useState<DatabaseOverview | null>(null);
	const [databasePage, setDatabasePage] = useState<DatabasePage | null>(null);
	const [selectedTable, setSelectedTable] = useState("");
	const [databaseLoading, setDatabaseLoading] = useState(false);
	const [databaseError, setDatabaseError] = useState("");

	const cursor = useRef(0);
	const scrollRef = useRef<HTMLDivElement>(null);

	const tauri = inTauri();

	// Load the current runtime log level once on mount.
	useEffect(() => {
		Promise.allSettled([
			devtools.getLogLevel(),
			devtools.getFileLogLevel(),
		]).then(([runtime, file]) => {
			if (runtime.status === "fulfilled") setLogLevelState(runtime.value);
			if (file.status === "fulfilled") setFileLogLevelState(file.value);
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

	const changeFileLogLevel = useCallback(
		async (level: LogLevel) => {
			if (level === "debug" && fileLogLevel !== "debug") {
				const ok = await confirm.ask(
					"Enable debug file logs?",
					"DEBUG will write high-volume logs to disk and may make log files grow quickly.",
				);
				if (!ok) return;
			}

			const previous = fileLogLevel;
			setFileLogLevelState(level);
			try {
				const applied = await devtools.setFileLogLevel(level);
				setFileLogLevelState(applied);
				toast.success(`File log level set to ${applied}`);
			} catch (err) {
				setFileLogLevelState(previous);
				toast.error(
					err instanceof Error ? err.message : "Failed to set file log level",
				);
			}
		},
		[fileLogLevel],
	);

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
			const message = l.message.toLowerCase();
			if (
				activityScope === "communication" &&
				!message.includes("communication")
			) {
				return false;
			}
			if (activityScope === "database" && !message.includes("database/")) {
				return false;
			}
			if (sourceFilter !== "all" && l.source !== sourceFilter) return false;
			if (levelFilter !== "all" && l.level !== levelFilter) return false;
			if (q && !message.includes(q)) return false;
			return true;
		});
	}, [activityScope, logs, sourceFilter, levelFilter, query]);

	const clear = useCallback(async () => {
		try {
			await devtools.clear();
			setLogs([]);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "clear failed");
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
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to export logs");
		}
	}, [filtered]);

	const restartService = useCallback(async (service: "engine" | "gateway") => {
		const accepted = await confirm.ask(
			`Restart ${service}?`,
			service === "engine"
				? "The local Engine will briefly stop. In-flight requests can fail while its database and API are reopened."
				: "The local Gateway will briefly stop. In-flight model requests and streams can be interrupted.",
		);
		if (!accepted) return;

		setRestarting(service);
		try {
			await devtools.restartService(service);
			setStatuses(await devtools.status());
			toast.success(`${service === "engine" ? "Engine" : "Gateway"} restarted`);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : `Failed to restart ${service}`,
			);
		} finally {
			setRestarting(null);
		}
	}, []);

	const loadDatabaseRows = useCallback(async (table: string, offset = 0) => {
		setDatabaseLoading(true);
		setDatabaseError("");
		try {
			const page = await devtools.databaseRows(
				table,
				DATABASE_PAGE_SIZE,
				offset,
			);
			setSelectedTable(table);
			setDatabasePage(page);
		} catch (error) {
			setDatabaseError(
				error instanceof Error
					? error.message
					: "Failed to read database table",
			);
		} finally {
			setDatabaseLoading(false);
		}
	}, []);

	const loadDatabase = useCallback(async () => {
		setDatabaseLoading(true);
		setDatabaseError("");
		try {
			const overview = await devtools.databaseOverview();
			setDatabaseOverview(overview);
			const nextTable =
				overview.tables.find((table) => table.name === selectedTable)?.name ??
				overview.tables[0]?.name;
			if (nextTable) {
				const page = await devtools.databaseRows(
					nextTable,
					DATABASE_PAGE_SIZE,
					0,
				);
				setSelectedTable(nextTable);
				setDatabasePage(page);
			} else {
				setSelectedTable("");
				setDatabasePage(null);
			}
		} catch (error) {
			setDatabaseError(
				error instanceof Error ? error.message : "Failed to inspect database",
			);
		} finally {
			setDatabaseLoading(false);
		}
	}, [selectedTable]);

	useEffect(() => {
		if (view === "database" && databaseOverview === null) {
			void loadDatabase();
		}
	}, [databaseOverview, loadDatabase, view]);

	if (!tauri) {
		return (
			<p className="py-10 text-center text-sm text-text-muted">
				Developer tools are only available in the desktop app.
			</p>
		);
	}

	return (
		<div className="flex h-full flex-col space-y-4">
			<div className="flex items-start gap-3 border-y border-warning/40 bg-warning/5 px-3 py-2.5">
				<span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-warning" />
				<div className="min-w-0">
					<p className="text-xs font-semibold text-text-primary">
						Full local diagnostics are active
					</p>
					<p className="mt-0.5 text-[11px] leading-5 text-text-muted">
						Request and response bodies may be written to the local log folder.
						Authentication headers remain redacted.
					</p>
				</div>
			</div>

			<div className="grid grid-cols-3 gap-3 max-[520px]:grid-cols-1">
				{statuses.map((s) => (
					<StatusCard
						key={s.name}
						svc={s}
						restarting={restarting === s.name}
						onRestart={
							s.name === "engine" || s.name === "gateway"
								? () => void restartService(s.name as "engine" | "gateway")
								: undefined
						}
					/>
				))}
			</div>

			<div
				role="tablist"
				aria-label="Developer tools views"
				className="flex w-fit rounded-md bg-surface-alt p-0.5"
			>
				{(
					[
						["activity", "Activity", Activity],
						["database", "Database", Database],
					] as const
				).map(([id, label, Icon]) => (
					<button
						key={id}
						type="button"
						role="tab"
						aria-selected={view === id}
						onClick={() => setView(id)}
						className={`flex min-h-8 items-center gap-1.5 rounded px-3 text-xs font-medium transition-colors ${
							view === id
								? "bg-surface text-text-primary shadow-sm"
								: "text-text-muted hover:text-text-primary"
						}`}
					>
						<Icon className="h-3.5 w-3.5" />
						{label}
					</button>
				))}
			</div>

			{view === "activity" ? (
				<>
					<div className="flex flex-wrap items-center gap-3">
						<label className="flex items-center gap-2">
							<span className="text-xs font-medium text-text-secondary">
								Runtime log level
							</span>
							<select
								value={logLevel}
								onChange={(event) =>
									changeLogLevel(event.target.value as LogLevel)
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
								File log level
							</span>
							<select
								value={fileLogLevel}
								onChange={(event) =>
									changeFileLogLevel(event.target.value as LogLevel)
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
						<span className="text-[11px] text-text-muted">
							runtime controls emitted logs; file controls disk storage
						</span>
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
							type="search"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Search logs..."
							aria-label="Search logs"
							className="min-w-32 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-xs text-text-primary placeholder:text-text-muted"
						/>
						<label className="flex items-center gap-1.5 text-xs text-text-muted">
							<input
								type="checkbox"
								checked={follow}
								onChange={(event) => setFollow(event.target.checked)}
							/>
							Follow
						</label>
						<button
							type="button"
							onClick={() =>
								devtools.openDevtools().catch((error) => {
									toast.error(
										error instanceof Error
											? error.message
											: "Failed to open DevTools",
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
							onClick={() =>
								devtools.openLogDirectory().catch((error) => {
									toast.error(
										error instanceof Error
											? error.message
											: "Failed to open log folder",
									);
								})
							}
							aria-label="Open log folder"
							title="Open log folder"
							className="rounded-md p-1.5 text-text-muted hover:bg-surface-hover hover:text-text-primary"
						>
							<FolderOpen className="h-4 w-4" />
						</button>
						<button
							type="button"
							onClick={() => void exportLogs()}
							disabled={filtered.length === 0}
							aria-label="Export logs"
							title="Export"
							className="rounded-md p-1.5 text-text-muted hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
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
									<span className="shrink-0 text-text-muted">
										[{entry.source}]
									</span>
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
				</>
			) : (
				<div className="flex min-h-[360px] flex-1 overflow-hidden rounded-md border border-border">
					<aside className="w-52 shrink-0 overflow-y-auto border-r border-border bg-surface-alt/30 p-2 max-[760px]:w-40">
						<div className="mb-2 flex items-center justify-between px-1">
							<span className="text-[10px] font-semibold text-text-muted">
								TABLES
							</span>
							<button
								type="button"
								onClick={() => void loadDatabase()}
								disabled={databaseLoading}
								aria-label="Refresh database"
								title="Refresh database"
								className="rounded p-1 text-text-muted hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
							>
								<RefreshCw
									className={`h-3.5 w-3.5 ${databaseLoading ? "animate-spin" : ""}`}
								/>
							</button>
						</div>
						{databaseOverview?.tables.map((table) => (
							<button
								key={table.name}
								type="button"
								onClick={() => void loadDatabaseRows(table.name)}
								aria-current={selectedTable === table.name ? "page" : undefined}
								className={`mb-0.5 flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs ${
									selectedTable === table.name
										? "bg-selected text-text-primary"
										: "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
								}`}
							>
								<span className="truncate font-mono">{table.name}</span>
								<span className="shrink-0 text-[10px] text-text-muted">
									{table.row_count}
								</span>
							</button>
						))}
					</aside>

					<section className="flex min-w-0 flex-1 flex-col">
						<header className="flex min-h-11 items-center justify-between gap-3 border-b border-border px-3 py-2">
							<div className="min-w-0">
								<p className="truncate font-mono text-xs font-semibold text-text-primary">
									{selectedTable || "Database"}
								</p>
								<p
									className="truncate text-[10px] text-text-muted"
									title={databaseOverview?.path}
								>
									{databaseOverview?.path || "Read-only local database browser"}
								</p>
							</div>
							{databasePage && (
								<div className="flex shrink-0 items-center gap-1 text-[10px] text-text-muted">
									<span>
										{databasePage.total_rows === 0
											? "0 rows"
											: `${databasePage.offset + 1}-${Math.min(
													databasePage.offset + databasePage.rows.length,
													databasePage.total_rows,
												)} of ${databasePage.total_rows}`}
									</span>
									<button
										type="button"
										onClick={() =>
											void loadDatabaseRows(
												databasePage.table,
												Math.max(0, databasePage.offset - databasePage.limit),
											)
										}
										disabled={databasePage.offset === 0 || databaseLoading}
										aria-label="Previous database page"
										className="rounded p-1 hover:bg-surface-hover disabled:opacity-30"
									>
										<ChevronLeft className="h-3.5 w-3.5" />
									</button>
									<button
										type="button"
										onClick={() =>
											void loadDatabaseRows(
												databasePage.table,
												databasePage.offset + databasePage.limit,
											)
										}
										disabled={
											databaseLoading ||
											databasePage.offset + databasePage.limit >=
												databasePage.total_rows
										}
										aria-label="Next database page"
										className="rounded p-1 hover:bg-surface-hover disabled:opacity-30"
									>
										<ChevronRight className="h-3.5 w-3.5" />
									</button>
								</div>
							)}
						</header>

						<div className="min-h-0 flex-1 overflow-auto">
							{databaseError ? (
								<p className="p-5 text-sm text-danger">{databaseError}</p>
							) : databaseLoading && !databasePage ? (
								<div className="flex h-full items-center justify-center text-text-muted">
									<RefreshCw className="h-4 w-4 animate-spin" />
								</div>
							) : databasePage ? (
								<table className="min-w-full border-collapse text-left font-mono text-[10px]">
									<thead className="sticky top-0 z-10 bg-surface-alt text-text-muted">
										<tr>
											{databasePage.columns.map((column) => (
												<th
													key={column}
													className="whitespace-nowrap border-b border-r border-border px-2 py-1.5 font-semibold last:border-r-0"
												>
													{column}
												</th>
											))}
										</tr>
									</thead>
									<tbody>
										{databasePage.rows.map((row, rowIndex) => (
											<tr
												key={`${databasePage.offset + rowIndex}`}
												className="border-b border-border last:border-b-0"
											>
												{row.map((cell, cellIndex) => (
													<td
														key={databasePage.columns[cellIndex]}
														className="max-w-72 whitespace-pre-wrap break-all border-r border-border px-2 py-1.5 align-top text-text-secondary last:border-r-0"
													>
														{cell === null ? (
															<span className="italic text-text-muted">
																NULL
															</span>
														) : (
															cell
														)}
													</td>
												))}
											</tr>
										))}
									</tbody>
								</table>
							) : (
								<p className="p-5 text-sm text-text-muted">
									No database tables.
								</p>
							)}
						</div>
					</section>
				</div>
			)}
		</div>
	);
}
