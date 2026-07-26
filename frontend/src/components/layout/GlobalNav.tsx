import {
	Check,
	ChevronDown,
	Home,
	Monitor,
	Moon,
	Plus,
	Settings,
	Sun,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useConversationStore } from "../../stores/conversationStore";
import { type Theme, useSettingsStore } from "../../stores/settingsStore";

const THEME_OPTIONS: {
	value: Theme;
	label: string;
	icon: typeof Sun;
}[] = [
	{ value: "light", label: "Light", icon: Sun },
	{ value: "dark", label: "Dark", icon: Moon },
	{ value: "system", label: "System", icon: Monitor },
];

function currentThemeIcon(theme: Theme) {
	if (theme === "light") return Sun;
	if (theme === "dark") return Moon;
	return Monitor;
}

export default function GlobalNav() {
	const newConversation = useConversationStore(
		(state) => state.newConversation,
	);
	const theme = useSettingsStore((state) => state.theme);
	const setTheme = useSettingsStore((state) => state.setTheme);
	const openSettings = useSettingsStore((state) => state.openSettings);
	const closeSettings = useSettingsStore((state) => state.closeSettings);
	const [appearanceOpen, setAppearanceOpen] = useState(false);
	const appearanceRef = useRef<HTMLDivElement>(null);
	const appearanceButtonRef = useRef<HTMLButtonElement>(null);
	const themeOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
	const ThemeIcon = currentThemeIcon(theme);
	const switchAppearance = () => {
		setAppearanceOpen(false);
		setTheme(
			document.documentElement.classList.contains("dark") ? "light" : "dark",
		);
	};
	const focusThemeOption = (index: number) => {
		const target = (index + THEME_OPTIONS.length) % THEME_OPTIONS.length;
		themeOptionRefs.current[target]?.focus();
	};

	useEffect(() => {
		if (!appearanceOpen) return;

		const closeMenu = (event: PointerEvent) => {
			if (!appearanceRef.current?.contains(event.target as Node)) {
				setAppearanceOpen(false);
			}
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			setAppearanceOpen(false);
			appearanceButtonRef.current?.focus();
		};

		document.addEventListener("pointerdown", closeMenu);
		window.addEventListener("keydown", closeOnEscape);
		return () => {
			document.removeEventListener("pointerdown", closeMenu);
			window.removeEventListener("keydown", closeOnEscape);
		};
	}, [appearanceOpen]);

	return (
		<header className="flex h-16 shrink-0 items-center justify-between bg-app-canvas px-3">
			<nav
				aria-label="Global navigation"
				className="flex min-w-0 items-center gap-1"
			>
				<button
					type="button"
					onClick={closeSettings}
					aria-current="page"
					className="flex h-9 items-center gap-2 rounded-md border border-border bg-selected px-3 text-sm font-medium text-text-primary"
				>
					<Home className="h-4 w-4" />
					<span>Home</span>
				</button>
				<button
					type="button"
					onClick={() => void newConversation()}
					aria-label="New conversation"
					title="New conversation"
					className="flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-control hover:text-text-primary"
				>
					<Plus className="h-4 w-4" />
				</button>
			</nav>

			<div className="flex items-center gap-1">
				<div ref={appearanceRef} className="relative">
					<fieldset className="m-0 flex border-0 p-0">
						<legend className="sr-only">Appearance controls</legend>
						<button
							type="button"
							onClick={switchAppearance}
							aria-label="Switch appearance"
							title="Switch light or dark appearance"
							className="flex h-8 w-8 items-center justify-center rounded-l-md text-text-secondary transition-colors hover:bg-control hover:text-text-primary"
						>
							<ThemeIcon className="h-4 w-4" />
						</button>
						<button
							ref={appearanceButtonRef}
							type="button"
							onClick={() => setAppearanceOpen((open) => !open)}
							onKeyDown={(event) => {
								if (event.key !== "ArrowDown" && event.key !== "ArrowUp")
									return;
								event.preventDefault();
								setAppearanceOpen(true);
								requestAnimationFrame(() => {
									focusThemeOption(event.key === "ArrowDown" ? 0 : -1);
								});
							}}
							aria-label="Open appearance menu"
							aria-haspopup="menu"
							aria-expanded={appearanceOpen}
							title="Appearance options"
							className="flex h-8 w-6 items-center justify-center rounded-r-md text-text-secondary transition-colors hover:bg-control hover:text-text-primary"
						>
							<ChevronDown className="h-3 w-3" />
						</button>
					</fieldset>

					{appearanceOpen && (
						<div
							role="menu"
							aria-label="Appearance"
							className="absolute right-0 top-full z-50 mt-1 w-40 rounded-md border border-border bg-workspace p-1 shadow-lg"
						>
							<p className="px-2 py-1.5 text-[11px] font-medium text-text-muted">
								Appearance
							</p>
							{THEME_OPTIONS.map((option, index) => (
								<button
									key={option.value}
									ref={(element) => {
										themeOptionRefs.current[index] = element;
									}}
									type="button"
									role="menuitemradio"
									aria-checked={theme === option.value}
									onClick={() => {
										setTheme(option.value);
										setAppearanceOpen(false);
										appearanceButtonRef.current?.focus();
									}}
									onKeyDown={(event) => {
										if (event.key === "ArrowDown") {
											event.preventDefault();
											focusThemeOption(index + 1);
										} else if (event.key === "ArrowUp") {
											event.preventDefault();
											focusThemeOption(index - 1);
										} else if (event.key === "Home") {
											event.preventDefault();
											focusThemeOption(0);
										} else if (event.key === "End") {
											event.preventDefault();
											focusThemeOption(-1);
										}
									}}
									className="flex h-8 w-full items-center gap-2 rounded px-2 text-sm text-text-secondary hover:bg-control hover:text-text-primary"
								>
									<option.icon className="h-4 w-4" />
									<span>{option.label}</span>
									<Check
										className={`ml-auto h-3.5 w-3.5 ${
											theme === option.value ? "opacity-100" : "opacity-0"
										}`}
									/>
								</button>
							))}
						</div>
					)}
				</div>

				<button
					type="button"
					onClick={() => openSettings()}
					aria-label="Settings"
					title="Settings (Ctrl+,)"
					className="flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-control hover:text-text-primary"
				>
					<Settings className="h-4 w-4" />
				</button>
			</div>
		</header>
	);
}
