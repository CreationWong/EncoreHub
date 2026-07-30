import {
	ArrowRight,
	Bug,
	Cpu,
	Database,
	ScrollText,
	ShieldCheck,
} from "lucide-react";
import { devtools, inTauri } from "../../services/devtools";
import { type SettingsTab, useSettingsStore } from "../../stores/settingsStore";
import { toast } from "../../stores/toastStore";

const FEATURES: Array<{
	id: Extract<SettingsTab, "processes" | "logs" | "database">;
	label: string;
	detail: string;
	icon: typeof Cpu;
}> = [
	{
		id: "processes",
		label: "System processes",
		detail: "Desktop, Engine, and Gateway runtime state",
		icon: Cpu,
	},
	{
		id: "logs",
		label: "Logs",
		detail: "Runtime levels, local files, filters, and exports",
		icon: ScrollText,
	},
	{
		id: "database",
		label: "Database",
		detail: "Read-only SQLite table inspection",
		icon: Database,
	},
];

export default function DeveloperPanel() {
	const openSettings = useSettingsStore((state) => state.openSettings);
	const fullCommunicationLogs = useSettingsStore(
		(state) => state.fullCommunicationLogs,
	);
	const tauri = inTauri();

	const openInspector = () => {
		void devtools.openDevtools().catch((error) => {
			toast.error(
				error instanceof Error ? error.message : "Failed to open DevTools",
			);
		});
	};

	return (
		<div className="mx-auto max-w-4xl space-y-6">
			<section
				aria-label="Developer mode status"
				className="flex items-start gap-3 border-y border-border py-4"
			>
				<ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" />
				<div className="min-w-0 flex-1">
					<p className="text-sm font-medium text-text-primary">
						Developer features enabled
					</p>
					<p className="mt-1 text-xs leading-5 text-text-muted">
						Communication logging is currently{" "}
						{fullCommunicationLogs ? "full" : "restricted"}.
					</p>
				</div>
				<span
					className={`shrink-0 rounded border px-2 py-1 text-[10px] font-medium ${
						fullCommunicationLogs
							? "border-warning/40 bg-warning/10 text-warning"
							: "border-success/30 bg-success/10 text-success"
					}`}
				>
					{fullCommunicationLogs ? "FULL LOGGING" : "RESTRICTED"}
				</span>
			</section>

			<section aria-labelledby="developer-tools-heading">
				<h3
					id="developer-tools-heading"
					className="mb-3 text-xs font-semibold text-text-muted"
				>
					Developer tools
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
										{feature.label}
									</p>
									<p className="mt-0.5 text-xs text-text-muted">
										{feature.detail}
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
					Utilities
				</h3>
				<button
					type="button"
					onClick={openInspector}
					disabled={!tauri}
					className="flex min-h-12 w-full items-center gap-3 border-y border-border px-1 py-3 text-left text-sm text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
				>
					<Bug className="h-4 w-4" />
					<span className="flex-1">Webview inspector</span>
					<span className="text-xs text-text-muted">
						{tauri ? "Open" : "Desktop only"}
					</span>
				</button>
			</section>
		</div>
	);
}
