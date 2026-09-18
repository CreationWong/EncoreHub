// Developer index: process, log, and database tools plus desktop utilities.

import {
	ArrowRight,
	Bug,
	Cpu,
	Database,
	MousePointer2,
	ScrollText,
	ShieldCheck,
} from "lucide-react";
import { type MessageKey, t, useT } from "../../i18n";
import { devtools, inTauri } from "../../services/devtools";
import { type SettingsTab, useSettingsStore } from "../../stores/settingsStore";
import { toast } from "../../stores/toastStore";

const FEATURES: Array<{
	id: Extract<SettingsTab, "processes" | "logs" | "database">;
	labelKey: MessageKey;
	detailKey: MessageKey;
	icon: typeof Cpu;
}> = [
	{
		id: "processes",
		labelKey: "developer.systemProcesses",
		detailKey: "developer.runtimeState",
		icon: Cpu,
	},
	{
		id: "logs",
		labelKey: "settings.logs",
		detailKey: "developer.logs",
		icon: ScrollText,
	},
	{
		id: "database",
		labelKey: "settings.database",
		detailKey: "developer.database",
		icon: Database,
	},
];

/** Developer-mode index for processes, logs, database, and desktop utilities. */
export default function DeveloperPanel() {
	const translate = useT();
	const openSettings = useSettingsStore((state) => state.openSettings);
	const fullCommunicationLogs = useSettingsStore(
		(state) => state.fullCommunicationLogs,
	);
	const globalContextMenuEnabled = useSettingsStore(
		(state) => state.globalContextMenuEnabled,
	);
	const setGlobalContextMenuEnabled = useSettingsStore(
		(state) => state.setGlobalContextMenuEnabled,
	);
	const tauri = inTauri();

	const openInspector = () => {
		void devtools.openDevtools().catch((error) => {
			toast.error(
				error instanceof Error
					? error.message
					: t("developer.openDevToolsFailed"),
			);
		});
	};

	return (
		<div className="mx-auto max-w-4xl space-y-6">
			<section
				aria-label={translate("developer.modeStatus")}
				className="flex items-start gap-3 border-y border-border py-4"
			>
				<ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" />
				<div className="min-w-0 flex-1">
					<p className="text-sm font-medium text-text-primary">
						{translate("developer.featuresEnabled")}
					</p>
					<p className="mt-1 text-xs leading-5 text-text-muted">
						{translate("developer.loggingStatus", {
							mode: fullCommunicationLogs
								? translate("developer.loggingFull")
								: translate("developer.loggingRestricted"),
						})}
					</p>
				</div>
				<span
					className={`shrink-0 rounded border px-2 py-1 text-[10px] font-medium ${
						fullCommunicationLogs
							? "border-warning/40 bg-warning/10 text-warning"
							: "border-success/30 bg-success/10 text-success"
					}`}
				>
					{fullCommunicationLogs
						? translate("developer.fullLogging")
						: translate("developer.restricted")}
				</span>
			</section>

			<section aria-labelledby="developer-tools-heading">
				<h3
					id="developer-tools-heading"
					className="mb-3 text-xs font-semibold text-text-muted"
				>
					{translate("developer.toolsHeading")}
				</h3>
				<div className="divide-y divide-border border-y border-border">
					{FEATURES.map((feature) => {
						const Icon = feature.icon;
						return (
							<button
								key={feature.id}
								type="button"
								onClick={() => openSettings(feature.id)}
								className="group flex min-h-16 w-full items-center gap-4 px-1 py-3 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
							>
								<Icon className="h-5 w-5 shrink-0 text-text-muted transition-colors group-hover:text-text-primary" />
								<div className="min-w-0 flex-1">
									<p className="text-sm font-medium text-text-primary">
										{translate(feature.labelKey)}
									</p>
									<p className="mt-0.5 text-xs text-text-muted">
										{translate(feature.detailKey)}
									</p>
								</div>
								<ArrowRight className="h-4 w-4 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-text-primary" />
							</button>
						);
					})}
				</div>
			</section>

			<section aria-labelledby="developer-utilities-heading">
				<h3
					id="developer-utilities-heading"
					className="mb-3 text-xs font-semibold text-text-muted"
				>
					{translate("common.utilities")}
				</h3>
				<button
					type="button"
					onClick={openInspector}
					disabled={!tauri}
					className="flex min-h-12 w-full items-center gap-3 border-y border-border px-1 py-3 text-left text-sm text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
				>
					<Bug className="h-4 w-4" />
					<span className="flex-1">
						{translate("developer.webviewInspector")}
					</span>
					<span className="text-xs text-text-muted">
						{tauri
							? translate("developer.open")
							: translate("developer.desktopOnly")}
					</span>
				</button>
				<div className="flex min-h-14 items-center gap-3 border-b border-border px-1 py-3">
					<MousePointer2 className="h-4 w-4 shrink-0 text-text-muted" />
					<span className="min-w-0 flex-1 text-sm text-text-secondary">
						{translate("developer.overrideContextMenu")}
					</span>
					<button
						type="button"
						role="switch"
						aria-checked={globalContextMenuEnabled}
						aria-label={translate("developer.overrideContextMenu")}
						onClick={() =>
							setGlobalContextMenuEnabled(!globalContextMenuEnabled)
						}
						className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
							globalContextMenuEnabled ? "bg-accent" : "bg-surface-hover"
						}`}
					>
						<span
							aria-hidden="true"
							className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
								globalContextMenuEnabled ? "translate-x-5" : "translate-x-1"
							}`}
						/>
					</button>
				</div>
			</section>
		</div>
	);
}
