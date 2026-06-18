import { Monitor, Moon, Sun } from "lucide-react";
import { type Theme, useSettingsStore } from "../../stores/settingsStore";

const THEMES: { id: Theme; label: string; icon: typeof Sun }[] = [
	{ id: "light", label: "Light", icon: Sun },
	{ id: "dark", label: "Dark", icon: Moon },
	{ id: "system", label: "System", icon: Monitor },
];

export default function AppearancePanel() {
	const theme = useSettingsStore((s) => s.theme);
	const setTheme = useSettingsStore((s) => s.setTheme);
	const devMode = useSettingsStore((s) => s.devMode);
	const setDevMode = useSettingsStore((s) => s.setDevMode);

	return (
		<div className="space-y-6">
			<section>
				<h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
					Theme
				</h3>
				<div className="grid grid-cols-3 gap-2">
					{THEMES.map((t) => (
						<button
							key={t.id}
							type="button"
							onClick={() => setTheme(t.id)}
							className={`flex flex-col items-center gap-2 rounded-lg border px-3 py-4 text-sm transition-colors ${
								theme === t.id
									? "border-accent bg-accent/10 text-accent"
									: "border-border text-text-secondary hover:bg-surface-hover"
							}`}
						>
							<t.icon className="h-5 w-5" />
							{t.label}
						</button>
					))}
				</div>
			</section>

			<section>
				<h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
					Developer
				</h3>
				<div className="flex items-center justify-between rounded-lg border border-border bg-surface-alt/40 p-3">
					<div className="min-w-0">
						<p className="text-sm font-medium text-text-primary">
							Developer mode
						</p>
						<p className="mt-0.5 text-xs text-text-muted">
							Show a Developer tab with service status and live logs.
						</p>
					</div>
					<button
						type="button"
						role="switch"
						aria-checked={devMode}
						aria-label="Toggle developer mode"
						onClick={() => setDevMode(!devMode)}
						className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
							devMode ? "bg-accent" : "bg-surface-hover"
						}`}
					>
						<span
							className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
								devMode ? "translate-x-5" : "translate-x-1"
							}`}
						/>
					</button>
				</div>
			</section>

			<section className="text-xs text-text-muted">
				<p>
					Keyboard shortcut:{" "}
					<kbd className="rounded bg-surface-alt px-1.5 py-0.5">
						Ctrl/Cmd + ,
					</kbd>{" "}
					to open settings,{" "}
					<kbd className="rounded bg-surface-alt px-1.5 py-0.5">Esc</kbd> to
					close.
				</p>
			</section>
		</div>
	);
}
