import { Check, Monitor, Moon, Sigma, Sun } from "lucide-react";
import { getRuntimePlatform } from "../../services/runtimePlatform";
import {
	type MathRenderer,
	type Theme,
	useSettingsStore,
} from "../../stores/settingsStore";

const THEMES: { id: Theme; label: string; icon: typeof Sun }[] = [
	{ id: "light", label: "Light", icon: Sun },
	{ id: "dark", label: "Dark", icon: Moon },
	{ id: "system", label: "System", icon: Monitor },
];

const MATH_RENDERERS: { id: MathRenderer; label: string; detail: string }[] = [
	{
		id: "katex",
		label: "KaTeX",
		detail: "Fast server-style typesetting with bundled fonts.",
	},
	{
		id: "mathjax",
		label: "MathJax",
		detail: "Self-contained SVG output with broader TeX coverage.",
	},
	{
		id: "off",
		label: "Off",
		detail: "Leave LaTeX delimiters as plain text.",
	},
];

export default function AppearancePanel() {
	const theme = useSettingsStore((state) => state.theme);
	const setTheme = useSettingsStore((state) => state.setTheme);
	const trafficLights = useSettingsStore(
		(state) => state.trafficLightWindowControls,
	);
	const setTrafficLights = useSettingsStore(
		(state) => state.setTrafficLightWindowControls,
	);
	const mathRenderer = useSettingsStore((state) => state.mathRenderer);
	const setMathRenderer = useSettingsStore((state) => state.setMathRenderer);
	const platform = getRuntimePlatform();

	return (
		<div className="mx-auto max-w-3xl space-y-8">
			<section aria-labelledby="appearance-theme-heading">
				<div className="mb-3">
					<h3
						id="appearance-theme-heading"
						className="text-sm font-semibold text-text-primary"
					>
						Theme
					</h3>
					<p className="mt-1 text-xs text-text-muted">
						Choose how application surfaces and content are rendered.
					</p>
				</div>
				<div
					aria-label="Application theme"
					className="grid grid-cols-3 overflow-hidden rounded-md border border-border bg-surface-alt/40"
				>
					{THEMES.map((option, index) => {
						const selected = theme === option.id;
						return (
							<button
								key={option.id}
								type="button"
								aria-pressed={selected}
								onClick={() => setTheme(option.id)}
								className={`flex h-12 min-w-0 items-center justify-center gap-2 px-3 text-sm transition-colors ${
									index > 0 ? "border-l border-border" : ""
								} ${
									selected
										? "bg-selected text-text-primary"
										: "text-text-secondary hover:bg-control hover:text-text-primary"
								}`}
							>
								<option.icon className="h-4 w-4 shrink-0" />
								<span className="truncate">{option.label}</span>
								<Check
									aria-hidden="true"
									className={`h-3.5 w-3.5 shrink-0 ${
										selected ? "opacity-100" : "opacity-0"
									}`}
								/>
							</button>
						);
					})}
				</div>
			</section>

			<section aria-labelledby="math-renderer-heading">
				<div className="mb-3">
					<h3
						id="math-renderer-heading"
						className="text-sm font-semibold text-text-primary"
					>
						Math rendering
					</h3>
					<p className="mt-1 text-xs text-text-muted">
						Choose the engine that typesets LaTeX math in chat responses.
					</p>
				</div>
				<div
					aria-label="Math rendering engine"
					className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface-alt/40"
				>
					{MATH_RENDERERS.map((option) => {
						const selected = mathRenderer === option.id;
						return (
							<button
								key={option.id}
								type="button"
								aria-pressed={selected}
								onClick={() => setMathRenderer(option.id)}
								className={`flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
									selected ? "bg-selected" : "hover:bg-control"
								}`}
							>
								<Sigma className="h-4 w-4 shrink-0 text-text-muted" />
								<span className="min-w-0 flex-1">
									<span
										className={`block text-sm ${
											selected
												? "font-medium text-text-primary"
												: "text-text-secondary"
										}`}
									>
										{option.label}
									</span>
									<span className="mt-0.5 block text-xs text-text-muted">
										{option.detail}
									</span>
								</span>
								<Check
									aria-hidden="true"
									className={`h-3.5 w-3.5 shrink-0 ${
										selected ? "opacity-100" : "opacity-0"
									}`}
								/>
							</button>
						);
					})}
				</div>
			</section>

			{platform === "windows" && (
				<section aria-labelledby="window-style-heading">
					<div className="mb-3">
						<h3
							id="window-style-heading"
							className="text-sm font-semibold text-text-primary"
						>
							Window controls
						</h3>
						<p className="mt-1 text-xs text-text-muted">
							Customize the controls in the EncoreHub titlebar.
						</p>
					</div>
					<div className="flex min-h-16 items-center gap-4 border-y border-border py-3">
						<div
							aria-hidden="true"
							className="flex h-8 w-24 shrink-0 items-center justify-center gap-2 rounded-md bg-control"
						>
							<span className="h-3 w-3 rounded-full bg-window-minimize" />
							<span className="h-3 w-3 rounded-full bg-window-maximize" />
							<span className="h-3 w-3 rounded-full bg-window-close" />
						</div>
						<div className="min-w-0 flex-1">
							<p className="text-sm font-medium text-text-primary">
								Traffic-light colors
							</p>
							<p className="mt-0.5 text-xs text-text-muted">
								Use yellow, green, and red hover colors for window actions.
							</p>
						</div>
						<button
							type="button"
							role="switch"
							aria-checked={trafficLights}
							aria-label="Use traffic-light window controls"
							onClick={() => setTrafficLights(!trafficLights)}
							className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
								trafficLights ? "bg-accent" : "bg-surface-hover"
							}`}
						>
							<span
								aria-hidden="true"
								className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
									trafficLights ? "translate-x-5" : "translate-x-1"
								}`}
							/>
						</button>
					</div>
				</section>
			)}
		</div>
	);
}
