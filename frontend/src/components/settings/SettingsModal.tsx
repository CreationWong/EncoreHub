import {
	BookOpen,
	Bot,
	Database,
	Loader2,
	Palette,
	ShieldCheck,
	Sparkles,
	Terminal,
	X,
} from "lucide-react";
import { Suspense, lazy, useEffect } from "react";
import { type SettingsTab, useSettingsStore } from "../../stores/settingsStore";
import AppearancePanel from "./AppearancePanel";
import KnowledgePanel from "./KnowledgePanel";
import MemoryPanel from "./MemoryPanel";
import ProvidersPanel from "./ProvidersPanel";
import SecurityPanel from "./SecurityPanel";
import SkillsPanel from "./SkillsPanel";

const DeveloperPanel = lazy(() => import("./DeveloperPanel"));

const TABS: { id: SettingsTab; label: string; icon: typeof Bot }[] = [
	{ id: "providers", label: "Providers", icon: Bot },
	{ id: "skills", label: "Skills", icon: Sparkles },
	{ id: "knowledge", label: "Knowledge", icon: Database },
	{ id: "memories", label: "Memories", icon: BookOpen },
	{ id: "security", label: "Security", icon: ShieldCheck },
	{ id: "appearance", label: "Appearance", icon: Palette },
];

const DEV_TAB: { id: SettingsTab; label: string; icon: typeof Bot } = {
	id: "developer",
	label: "Developer",
	icon: Terminal,
};

export default function SettingsModal() {
	const open = useSettingsStore((s) => s.settingsOpen);
	const tab = useSettingsStore((s) => s.settingsTab);
	const setTab = useSettingsStore((s) => s.openSettings);
	const close = useSettingsStore((s) => s.closeSettings);
	const devMode = useSettingsStore((s) => s.devMode);

	const tabs = devMode ? [...TABS, DEV_TAB] : TABS;

	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") close();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, close]);

	if (!open) return null;

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
			onClick={close}
			onKeyDown={(e) => {
				if (e.key === "Escape") close();
			}}
			role="presentation"
		>
			<dialog
				open
				className="flex h-[780px] max-h-full w-full max-w-7xl overflow-hidden rounded-lg border border-border bg-surface text-text-primary shadow-2xl"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => e.stopPropagation()}
				aria-modal="true"
			>
				{/* Sidebar */}
				<aside className="flex w-48 flex-col border-r border-border bg-surface-alt p-3 max-[760px]:w-14 max-[760px]:px-2">
					<div className="mb-4 px-2 text-sm font-semibold text-text-primary max-[760px]:hidden">
						Settings
					</div>
					{tabs.map((t) => (
						<button
							key={t.id}
							type="button"
							onClick={() => setTab(t.id)}
							title={t.label}
							className={`mb-1 flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors max-[760px]:justify-center max-[760px]:px-2 ${
								tab === t.id
									? "bg-accent/10 text-accent"
									: "text-text-secondary hover:bg-surface-hover"
							}`}
						>
							<t.icon className="h-4 w-4" />
							<span className="max-[760px]:hidden">{t.label}</span>
						</button>
					))}
				</aside>

				{/* Content */}
				<div className="flex min-w-0 flex-1 flex-col">
					<header className="flex items-center justify-between border-b border-border px-5 py-3">
						<h2 className="text-sm font-semibold capitalize text-text-primary">
							{tab}
						</h2>
						<button
							type="button"
							onClick={close}
							aria-label="Close settings"
							title="Close (Esc)"
							className="rounded-md p-1 text-text-muted hover:bg-surface-hover hover:text-text-primary"
						>
							<X className="h-4 w-4" />
						</button>
					</header>
					<div
						className={
							tab === "providers"
								? "min-h-0 flex-1 overflow-hidden"
								: "flex-1 overflow-y-auto p-5"
						}
					>
						{tab === "providers" && <ProvidersPanel />}
						{tab === "skills" && <SkillsPanel />}
						{tab === "knowledge" && <KnowledgePanel />}
						{tab === "memories" && <MemoryPanel />}
						{tab === "security" && <SecurityPanel />}
						{tab === "appearance" && <AppearancePanel />}
						{tab === "developer" && (
							<Suspense
								fallback={
									<output
										className="flex min-h-32 items-center justify-center"
										aria-label="Loading developer tools"
									>
										<Loader2 className="h-5 w-5 animate-spin text-text-muted" />
									</output>
								}
							>
								<DeveloperPanel />
							</Suspense>
						)}
					</div>
				</div>
			</dialog>
		</div>
	);
}
