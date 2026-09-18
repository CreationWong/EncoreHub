// Live communication log slice filtered to one provider's matchers.

import { Bug, CirclePause, CirclePlay, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { t, useT } from "../../i18n";
import { type LogEntry, devtools, inTauri } from "../../services/devtools";
import { confirm } from "../../stores/confirmStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { toast } from "../../stores/toastStore";

const POLL_MS = 1000;
const MAX_ENTRIES = 500;

export interface ProviderDebugTarget {
	id: string;
	name: string;
	matchers: string[];
}

interface ProviderDebugPanelProps {
	target: ProviderDebugTarget;
	onClose: () => void;
}

/** True when a log line is tagged as provider communication. */
function isCommunicationEntry(entry: LogEntry): boolean {
	const message = entry.message.toLowerCase();
	return (
		message.includes("[communication]") ||
		message.includes("channel=communication") ||
		message.includes('"channel":"communication"')
	);
}

/** Lowercased id/name/URL needles used to filter communication lines. */
function normalizedMatchers(target: ProviderDebugTarget): string[] {
	const candidates = [target.id, target.name, ...target.matchers];
	const matchers = new Set<string>();
	const providerId = target.id.trim().toLowerCase();
	if (providerId) {
		matchers.add(`/providers/${providerId}/`);
		matchers.add(`"provider":"${providerId}"`);
		matchers.add(`provider=${providerId}`);
	}
	for (const candidate of candidates) {
		const normalized = candidate.trim().toLowerCase();
		if (normalized.length >= 3) matchers.add(normalized);
		try {
			const url = new URL(candidate);
			matchers.add(url.hostname.toLowerCase());
		} catch {
			/* Non-URL matchers are valid provider identifiers. */
		}
	}
	return [...matchers];
}

/** Side panel of communication logs matching one provider. */
export default function ProviderDebugPanel({
	target,
	onClose,
}: ProviderDebugPanelProps) {
	const translate = useT();
	const fullCommunicationLogs = useSettingsStore(
		(state) => state.fullCommunicationLogs,
	);
	const setFullCommunicationLogs = useSettingsStore(
		(state) => state.setFullCommunicationLogs,
	);
	const [entries, setEntries] = useState<LogEntry[]>([]);
	const [paused, setPaused] = useState(false);
	const [changingCapture, setChangingCapture] = useState(false);
	const cursor = useRef(0);
	const tauri = inTauri();
	const matchers = useMemo(() => normalizedMatchers(target), [target]);

	useEffect(() => {
		if (!tauri || paused) return;
		let alive = true;
		const poll = async () => {
			try {
				const fresh = await devtools.logs(cursor.current);
				if (!alive || fresh.length === 0) return;
				cursor.current = fresh[fresh.length - 1].seq;
				const matching = fresh.filter(
					(entry) =>
						isCommunicationEntry(entry) &&
						matchers.some((matcher) =>
							entry.message.toLowerCase().includes(matcher),
						),
				);
				if (matching.length === 0) return;
				setEntries((current) => [...current, ...matching].slice(-MAX_ENTRIES));
			} catch {
				/* The next poll retries transient desktop IPC failures. */
			}
		};

		void poll();
		const timer = window.setInterval(() => void poll(), POLL_MS);
		return () => {
			alive = false;
			window.clearInterval(timer);
		};
	}, [matchers, paused, tauri]);

	const toggleFullCapture = async () => {
		const enabled = !fullCommunicationLogs;
		if (
			enabled &&
			!(await confirm.ask(
				t("logs.enableFullTitle"),
				t("logs.enableFullMessage"),
			))
		) {
			return;
		}
		setChangingCapture(true);
		try {
			const applied = await devtools.setFullCommunicationLogs(enabled);
			setFullCommunicationLogs(applied);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : t("logs.changeFailed"),
			);
		} finally {
			setChangingCapture(false);
		}
	};

	return (
		<aside
			aria-label={translate("providers.debug", { name: target.name })}
			className="flex h-full w-[min(26rem,100%)] shrink-0 flex-col border-l border-border bg-surface shadow-lg max-[850px]:absolute max-[850px]:inset-y-0 max-[850px]:right-0 max-[850px]:z-20"
		>
			<header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
				<Bug className="h-4 w-4 text-accent" />
				<div className="min-w-0 flex-1">
					<h3 className="truncate text-sm font-semibold text-text-primary">
						{target.name}
					</h3>
					<p className="text-[11px] text-text-muted">
						{translate("providers.network")}
					</p>
				</div>
				<button
					type="button"
					onClick={onClose}
					aria-label={translate("providers.closeDebug")}
					title={translate("common.close")}
					className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-primary"
				>
					<X className="h-4 w-4" />
				</button>
			</header>

			<div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
				<button
					type="button"
					role="switch"
					aria-checked={fullCommunicationLogs}
					aria-label={translate("logs.fullTitle")}
					disabled={changingCapture}
					onClick={() => void toggleFullCapture()}
					className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
						fullCommunicationLogs ? "bg-warning" : "bg-surface-hover"
					} disabled:opacity-50`}
				>
					<span
						className={`h-3.5 w-3.5 rounded-full bg-white transition-transform ${
							fullCommunicationLogs ? "translate-x-5" : "translate-x-1"
						}`}
					/>
				</button>
				<span className="text-[11px] text-text-secondary">
					{translate("providers.fullCapture")}
				</span>
				<span className="ml-auto text-[11px] tabular-nums text-text-muted">
					{entries.length}
				</span>
				<button
					type="button"
					onClick={() => setPaused((current) => !current)}
					aria-label={
						paused
							? translate("providers.resumeLogs")
							: translate("providers.pauseLogs")
					}
					title={
						paused ? translate("common.resume") : translate("common.pause")
					}
					className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-primary"
				>
					{paused ? (
						<CirclePlay className="h-3.5 w-3.5" />
					) : (
						<CirclePause className="h-3.5 w-3.5" />
					)}
				</button>
				<button
					type="button"
					onClick={() => setEntries([])}
					aria-label={translate("providers.clearLogs")}
					title={translate("common.clear")}
					className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-danger"
				>
					<Trash2 className="h-3.5 w-3.5" />
				</button>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto bg-surface-alt/40 p-3 font-mono text-[11px] leading-5">
				{!tauri ? (
					<p className="py-8 text-center font-sans text-xs text-text-muted">
						{translate("providers.desktopLoggingUnavailable")}
					</p>
				) : entries.length === 0 ? (
					<p className="py-8 text-center font-sans text-xs text-text-muted">
						{translate("providers.noMatchingActivity")}
					</p>
				) : (
					entries.map((entry) => (
						<div
							key={entry.seq}
							className="mb-2 border-l-2 border-border bg-surface px-2.5 py-2"
						>
							<div className="mb-1 flex items-center gap-2 text-[10px] uppercase text-text-muted">
								<span>#{entry.seq}</span>
								<span>{entry.source}</span>
								<span>{entry.level}</span>
							</div>
							<pre className="whitespace-pre-wrap break-all text-text-secondary">
								{entry.message}
							</pre>
						</div>
					))
				)}
			</div>
		</aside>
	);
}

export const providerDebugInternals = {
	isCommunicationEntry,
	normalizedMatchers,
};
