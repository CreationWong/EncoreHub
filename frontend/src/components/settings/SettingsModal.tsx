import {
	BookOpen,
	Bot,
	Cpu,
	Database,
	Info,
	Loader2,
	MousePointer2,
	Palette,
	ScrollText,
	Search,
	ShieldCheck,
	Sparkles,
	Terminal,
} from "lucide-react";
import { Suspense, lazy, useEffect } from "react";
import {
	type SettingsTab,
	isDeveloperSettingsTab,
	useSettingsStore,
} from "../../stores/settingsStore";
import AppearancePanel from "./AppearancePanel";
import ContextMenuPanel from "./ContextMenuPanel";
import KnowledgePanel from "./KnowledgePanel";
import MemoryPanel from "./MemoryPanel";
import ProvidersPanel from "./ProvidersPanel";
import SecurityPanel from "./SecurityPanel";
import SkillsPanel from "./SkillsPanel";

const DeveloperPanel = lazy(() => import("./DeveloperPanel"));
const ProcessesPanel = lazy(() => import("./ProcessesPanel"));
const LogsPanel = lazy(() => import("./LogsPanel"));
const DatabasePanel = lazy(() => import("./DatabasePanel"));
const AboutPanel = lazy(() => import("./AboutPanel"));
const SearchPanel = lazy(() => import("./SearchPanel"));

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
		label: "Interface",
		tabs: [
			{ id: "appearance", label: "Appearance", icon: Palette },
			{ id: "context-menu", label: "Context menu", icon: MousePointer2 },
		],
	},
	{
		label: "AI & tools",
		tabs: [
			{ id: "providers", label: "Providers", icon: Bot },
			{ id: "search", label: "Web search", icon: Search },
			{ id: "skills", label: "Skills", icon: Sparkles },
		],
	},
	{
		label: "Data & privacy",
		tabs: [
			{ id: "knowledge", label: "Knowledge", icon: Database },
			{ id: "memories", label: "Memories", icon: BookOpen },
			{ id: "security", label: "Security", icon: ShieldCheck },
		],
	},
	{
		label: "System",
		tabs: [{ id: "about", label: "About", icon: Info }],
	},
];

const DEV_TABS: TabDefinition[] = [
	{ id: "developer", label: "Developer", icon: Terminal },
	{ id: "processes", label: "Processes", icon: Cpu },
	{ id: "logs", label: "Logs", icon: ScrollText },
	{ id: "database", label: "Database", icon: Database },
];

const TAB_LABELS = Object.fromEntries(
	[...TAB_GROUPS.flatMap((group) => group.tabs), ...DEV_TABS].map((tab) => [
		tab.id,
		tab.label,
	]),
) as Record<SettingsTab, string>;

const FULL_BLEED_TABS: readonly SettingsTab[] = [
	"providers",
	"processes",
	"logs",
	"database",
];

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
			? { ...group, tabs: [...group.tabs, ...DEV_TABS] }
			: group,
	);

	useEffect(() => {
		if (!devMode && isDeveloperSettingsTab(tab)) setTab("about");
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
						<fieldset key={group.label} className="m-0 min-w-0 border-0 p-0">
							<legend className="mb-1 w-full px-2 text-[10px] font-semibold text-text-muted max-[760px]:sr-only">
								{group.label}
							</legend>
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
						</fieldset>
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
						FULL_BLEED_TABS.includes(tab)
							? "min-h-0 flex-1 overflow-hidden"
							: "min-h-0 flex-1 overflow-y-auto p-5"
					}
				>
					{tab === "providers" && <ProvidersPanel />}
					{tab === "skills" && <SkillsPanel />}
					{tab === "search" && (
						<Suspense
							fallback={<LoadingPanel label="Loading web search settings" />}
						>
							<SearchPanel />
						</Suspense>
					)}
					{tab === "knowledge" && <KnowledgePanel />}
					{tab === "memories" && <MemoryPanel />}
					{tab === "security" && <SecurityPanel />}
					{tab === "appearance" && <AppearancePanel />}
					{tab === "context-menu" && <ContextMenuPanel />}
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
					{tab === "processes" && (
						<Suspense fallback={<LoadingPanel label="Loading processes" />}>
							<ProcessesPanel />
						</Suspense>
					)}
					{tab === "logs" && (
						<Suspense fallback={<LoadingPanel label="Loading logs" />}>
							<LogsPanel />
						</Suspense>
					)}
					{tab === "database" && (
						<Suspense fallback={<LoadingPanel label="Loading database" />}>
							<DatabasePanel />
						</Suspense>
					)}
				</div>
			</div>
		</section>
	);
}
