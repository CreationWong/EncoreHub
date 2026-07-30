import {
	BookOpen,
	Bot,
	Database,
	Info,
	Loader2,
	Palette,
	ShieldCheck,
	Sparkles,
	Terminal,
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
const AboutPanel = lazy(() => import("./AboutPanel"));

interface TabDefinition {
	id: SettingsTab;
	label: string;
	icon: typeof Bot;
}

interface TabGroup {
	label: string;
	tabs: TabDefinition[];
}

const TAB_GROUPS: TabGroup[] = [
	{
		label: "General",
		tabs: [
			{ id: "providers", label: "Providers", icon: Bot },
			{ id: "appearance", label: "Appearance", icon: Palette },
		],
	},
	{
		label: "Capabilities",
		tabs: [
			{ id: "skills", label: "Skills", icon: Sparkles },
			{ id: "knowledge", label: "Knowledge", icon: Database },
			{ id: "memories", label: "Memories", icon: BookOpen },
		],
	},
	{
		label: "Data & safety",
		tabs: [{ id: "security", label: "Security", icon: ShieldCheck }],
	},
	{
		label: "System",
		tabs: [{ id: "about", label: "About", icon: Info }],
	},
];

const DEV_TAB: TabDefinition = {
	id: "developer",
	label: "Developer",
	icon: Terminal,
};

const TAB_LABELS = Object.fromEntries(
	[...TAB_GROUPS.flatMap((group) => group.tabs), DEV_TAB].map((tab) => [
		tab.id,
		tab.label,
	]),
) as Record<SettingsTab, string>;

function LoadingPanel({ label }: { label: string }) {
	return (
		<output
			className="flex min-h-32 items-center justify-center"
			aria-label={label}
		>
			<Loader2 className="h-5 w-5 animate-spin text-text-muted" />
		</output>
	);
}

export default function SettingsModal() {
	const tab = useSettingsStore((s) => s.settingsTab);
	const setTab = useSettingsStore((s) => s.openSettings);
	const devMode = useSettingsStore((s) => s.devMode);

	const tabGroups = TAB_GROUPS.map((group) =>
		group.label === "System" && devMode
			? { ...group, tabs: [...group.tabs, DEV_TAB] }
			: group,
	);

	useEffect(() => {
		if (!devMode && tab === "developer") setTab("about");
	}, [devMode, setTab, tab]);

	return (
		<section
			aria-label="Settings"
			className="flex h-full min-h-0 w-full overflow-hidden bg-workspace text-text-primary"
		>
			<aside className="flex w-52 shrink-0 flex-col overflow-y-auto border-r border-border bg-surface-alt p-3 max-[760px]:w-14 max-[760px]:px-2">
				<div className="mb-4 px-2 text-sm font-semibold text-text-primary max-[760px]:hidden">
					Settings
				</div>
				<nav aria-label="Settings sections" className="space-y-3">
					{tabGroups.map((group) => (
						<div key={group.label}>
							<p className="mb-1 px-2 text-[10px] font-semibold text-text-muted max-[760px]:sr-only">
								{group.label}
							</p>
							{group.tabs.map((item) => (
								<button
									key={item.id}
									type="button"
									onClick={() => setTab(item.id)}
									aria-current={tab === item.id ? "page" : undefined}
									title={item.label}
									className={`mb-0.5 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors max-[760px]:justify-center max-[760px]:px-2 ${
										tab === item.id
											? "bg-selected text-text-primary"
											: "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
									}`}
								>
									<item.icon className="h-4 w-4 shrink-0" />
									<span className="truncate max-[760px]:hidden">
										{item.label}
									</span>
								</button>
							))}
						</div>
					))}
				</nav>
			</aside>

			<div className="flex min-w-0 flex-1 flex-col">
				<header className="flex h-14 shrink-0 items-center border-b border-border px-5">
					<h2 className="text-sm font-semibold text-text-primary">
						{TAB_LABELS[tab]}
					</h2>
				</header>
				<div
					className={
						tab === "providers"
							? "min-h-0 flex-1 overflow-hidden"
							: "min-h-0 flex-1 overflow-y-auto p-5"
					}
				>
					{tab === "providers" && <ProvidersPanel />}
					{tab === "skills" && <SkillsPanel />}
					{tab === "knowledge" && <KnowledgePanel />}
					{tab === "memories" && <MemoryPanel />}
					{tab === "security" && <SecurityPanel />}
					{tab === "appearance" && <AppearancePanel />}
					{tab === "about" && (
						<Suspense
							fallback={
								<LoadingPanel label="Loading application information" />
							}
						>
							<AboutPanel />
						</Suspense>
					)}
					{tab === "developer" && (
						<Suspense
							fallback={<LoadingPanel label="Loading developer tools" />}
						>
							<DeveloperPanel />
						</Suspense>
					)}
				</div>
			</div>
		</section>
	);
}
