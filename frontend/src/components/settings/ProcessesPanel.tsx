import { RefreshCw, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { type ServiceStatus, devtools, inTauri } from "../../services/devtools";
import { confirm } from "../../stores/confirmStore";
import { toast } from "../../stores/toastStore";

const POLL_MS = 1500;

function uptimeLabel(secs: number): string {
	if (secs <= 0) return "—";
	const h = Math.floor(secs / 3600);
	const m = Math.floor((secs % 3600) / 60);
	const s = secs % 60;
	if (h > 0) return `${h}h ${m}m`;
	if (m > 0) return `${m}m ${s}s`;
	return `${s}s`;
}

export default function ProcessesPanel() {
	const [statuses, setStatuses] = useState<ServiceStatus[]>([]);
	const [loading, setLoading] = useState(true);
	const [restarting, setRestarting] = useState<"engine" | "gateway" | null>(
		null,
	);
	const tauri = inTauri();

	const refresh = useCallback(async () => {
		if (!tauri) return;
		try {
			setStatuses(await devtools.status());
		} catch {
			/* A later poll retries transient desktop IPC failures. */
		} finally {
			setLoading(false);
		}
	}, [tauri]);

	useEffect(() => {
		if (!tauri) return;
		void refresh();
		const interval = window.setInterval(() => void refresh(), POLL_MS);
		return () => window.clearInterval(interval);
	}, [refresh, tauri]);

	const restartService = async (service: "engine" | "gateway") => {
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
			await refresh();
			toast.success(`${service === "engine" ? "Engine" : "Gateway"} restarted`);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : `Failed to restart ${service}`,
			);
		} finally {
			setRestarting(null);
		}
	};

	if (!tauri) {
		return (
			<p className="p-10 text-center text-sm text-text-muted">
				System processes are only available in the desktop app.
			</p>
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col p-5">
			<div className="mb-4 flex items-center justify-between gap-4">
				<div>
					<p className="text-sm font-medium text-text-primary">Local runtime</p>
					<p className="mt-1 text-xs text-text-muted">
						Desktop host and managed services
					</p>
				</div>
				<button
					type="button"
					onClick={() => void refresh()}
					disabled={loading}
					aria-label="Refresh process status"
					title="Refresh process status"
					className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
				>
					<RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
				</button>
			</div>

			<div className="min-h-0 overflow-auto border-y border-border">
				<div className="grid min-w-[660px] grid-cols-[minmax(180px,1fr)_110px_100px_100px_64px] gap-4 border-b border-border bg-surface-alt/50 px-3 py-2 text-[10px] font-semibold text-text-muted">
					<span>PROCESS</span>
					<span>PID</span>
					<span>PORT</span>
					<span>UPTIME</span>
					<span className="text-right">ACTION</span>
				</div>
				{statuses.map((service) => {
					const restartable =
						service.name === "engine" || service.name === "gateway";
					const isRestarting = restarting === service.name;
					return (
						<div
							key={service.name}
							className="grid min-w-[660px] grid-cols-[minmax(180px,1fr)_110px_100px_100px_64px] items-center gap-4 border-b border-border px-3 py-3 last:border-b-0"
						>
							<div className="flex min-w-0 items-center gap-3">
								<span
									aria-hidden="true"
									className={`h-2 w-2 shrink-0 rounded-full ${service.running ? "bg-success" : "bg-danger"}`}
								/>
								<div className="min-w-0">
									<p className="truncate text-sm font-medium capitalize text-text-primary">
										{service.name}
									</p>
									<p
										className={`text-[10px] ${service.running ? "text-success" : "text-danger"}`}
									>
										{isRestarting
											? "restarting"
											: service.running
												? "running"
												: "stopped"}
									</p>
								</div>
							</div>
							<span className="font-mono text-xs text-text-secondary">
								{service.pid ?? "—"}
							</span>
							<span className="font-mono text-xs text-text-secondary">
								{service.port || "—"}
							</span>
							<span className="font-mono text-xs text-text-secondary">
								{uptimeLabel(service.uptime_secs)}
							</span>
							<div className="flex justify-end">
								{restartable && (
									<button
										type="button"
										onClick={() =>
											void restartService(service.name as "engine" | "gateway")
										}
										disabled={isRestarting}
										aria-label={`Restart ${service.name}`}
										title={`Restart ${service.name}`}
										className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-wait disabled:opacity-40"
									>
										<RotateCcw
											className={`h-4 w-4 ${isRestarting ? "animate-spin" : ""}`}
										/>
									</button>
								)}
							</div>
						</div>
					);
				})}
				{!loading && statuses.length === 0 && (
					<p className="p-8 text-center text-sm text-text-muted">
						No process status available.
					</p>
				)}
			</div>
		</div>
	);
}
