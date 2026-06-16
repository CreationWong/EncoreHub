import { BookOpen, Bot, Database, Palette, Sparkles, X } from "lucide-react";
import { useEffect } from "react";
import { type SettingsTab, useSettingsStore } from "../../stores/settingsStore";
import AppearancePanel from "./AppearancePanel";
import KnowledgePanel from "./KnowledgePanel";
import MemoryPanel from "./MemoryPanel";
import ProvidersPanel from "./ProvidersPanel";
import SkillsPanel from "./SkillsPanel";

const TABS: { id: SettingsTab; label: string; icon: typeof Bot }[] = [
	{ id: "providers", label: "Providers", icon: Bot },
	{ id: "skills", label: "Skills", icon: Sparkles },
	{ id: "knowledge", label: "Knowledge", icon: Database },
	{ id: "memories", label: "Memories", icon: BookOpen },
	{ id: "appearance", label: "Appearance", icon: Palette },
];

export default function SettingsModal() {
	const open = useSettingsStore((s) => s.settingsOpen);
	const tab = useSettingsStore((s) => s.settingsTab);
	const setTab = useSettingsStore((s) => s.openSettings);
	const close = useSettingsStore((s) => s.closeSettings);

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
				className="flex h-[640px] max-h-full w-full max-w-3xl overflow-hidden rounded-2xl border border-border bg-surface text-text-primary shadow-2xl"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => e.stopPropagation()}
				aria-modal="true"
			>
				{/* Sidebar */}
				<aside className="flex w-48 flex-col border-r border-border bg-surface-alt p-3">
					<div className="mb-4 px-2 text-sm font-semibold text-text-primary">
						Settings
					</div>
					{TABS.map((t) => (
						<button
							key={t.id}
							type="button"
							onClick={() => setTab(t.id)}
							className={`mb-1 flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
								tab === t.id
									? "bg-accent/10 text-accent"
									: "text-text-secondary hover:bg-surface-hover"
							}`}
						>
							<t.icon className="h-4 w-4" />
							{t.label}
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
							title="Close (Esc)"
							className="rounded-md p-1 text-text-muted hover:bg-surface-hover hover:text-text-primary"
						>
							<X className="h-4 w-4" />
						</button>
					</header>
					<div className="flex-1 overflow-y-auto p-5">
						{tab === "providers" && <ProvidersPanel />}
						{tab === "skills" && <SkillsPanel />}
						{tab === "knowledge" && <KnowledgePanel />}
						{tab === "memories" && <MemoryPanel />}
						{tab === "appearance" && <AppearancePanel />}
					</div>
				</div>
			</dialog>
		</div>
	);
}
