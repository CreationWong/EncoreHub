import { Check, Monitor, Moon, Sigma, Sun } from "lucide-react";
import { SYSTEM_LOCALE, listLocales, useT } from "../../i18n";
import { getRuntimePlatform } from "../../services/runtimePlatform";
import {
	type MathRenderer,
	type Theme,
	useSettingsStore,
} from "../../stores/settingsStore";

const THEMES: {
	id: Theme;
	labelKey: "common.light" | "common.dark" | "common.system";
	icon: typeof Sun;
}[] = [
	{ id: "light", labelKey: "common.light", icon: Sun },
	{ id: "dark", labelKey: "common.dark", icon: Moon },
	{ id: "system", labelKey: "common.system", icon: Monitor },
];

const MATH_RENDERERS: {
	id: MathRenderer;
	labelKey: "context.katex" | "context.mathjax" | "context.mathOff";
	detailKey:
		| "context.katexDetail"
		| "context.mathjaxDetail"
		| "context.mathOffDetail";
}[] = [
	{
		id: "katex",
		labelKey: "context.katex",
		detailKey: "context.katexDetail",
	},
	{
		id: "mathjax",
		labelKey: "context.mathjax",
		detailKey: "context.mathjaxDetail",
	},
	{
		id: "off",
		labelKey: "context.mathOff",
		detailKey: "context.mathOffDetail",
	},
];

export default function AppearancePanel() {
	const t = useT();
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
	const locale = useSettingsStore((state) => state.locale);
	const setLocale = useSettingsStore((state) => state.setLocale);
	const platform = getRuntimePlatform();
	const languageOptions = [
		{ id: SYSTEM_LOCALE, label: t("language.system") },
		...listLocales().map((pack) => ({ id: pack.id, label: pack.nativeName })),
	];

	return (
		<div className="mx-auto max-w-3xl space-y-8">
			<section aria-labelledby="appearance-language-heading">
				<div className="mb-3">
					<h3
						id="appearance-language-heading"
						className="text-sm font-semibold text-text-primary"
					>
						{t("language.label")}
					</h3>
					<p className="mt-1 text-xs text-text-muted">
						{t("language.description")}
					</p>
				</div>
				<div
					aria-label={t("language.group")}
					className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface-alt/40"
				>
					{languageOptions.map((option) => {
						const selected = locale === option.id;
						return (
							<button
								key={option.id}
								type="button"
								aria-pressed={selected}
								onClick={() => setLocale(option.id)}
								className={`flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
									selected ? "bg-selected" : "hover:bg-control"
								}`}
							>
								<span
									className={`min-w-0 flex-1 text-sm ${
										selected
											? "font-medium text-text-primary"
											: "text-text-secondary"
									}`}
								>
									{option.label}
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

			<section aria-labelledby="appearance-theme-heading">
				<div className="mb-3">
					<h3
						id="appearance-theme-heading"
						className="text-sm font-semibold text-text-primary"
					>
						{t("appearance.theme")}
					</h3>
					<p className="mt-1 text-xs text-text-muted">
						{t("appearance.themeHelp")}
					</p>
				</div>
				<div
					aria-label={t("appearance.themeGroup")}
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
								<span className="truncate">{t(option.labelKey)}</span>
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
						{t("appearance.math")}
					</h3>
					<p className="mt-1 text-xs text-text-muted">
						{t("appearance.mathHelp")}
					</p>
				</div>
				<div
					aria-label={t("appearance.mathGroup")}
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
										{t(option.labelKey)}
									</span>
									<span className="mt-0.5 block text-xs text-text-muted">
										{t(option.detailKey)}
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
							{t("appearance.windowControls")}
						</h3>
						<p className="mt-1 text-xs text-text-muted">
							{t("appearance.windowHelp")}
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
								{t("appearance.trafficLights")}
							</p>
							<p className="mt-0.5 text-xs text-text-muted">
								{t("appearance.trafficLightsHelp")}
							</p>
						</div>
						<button
							type="button"
							role="switch"
							aria-checked={trafficLights}
							aria-label={t("appearance.trafficLightsSwitch")}
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
