import {
	BookOpen,
	Bot,
	ChartNoAxesColumn,
	Cpu,
	Database,
	FolderArchive,
	Gauge,
	Info,
	Loader2,
	MessagesSquare,
	MousePointer2,
	Palette,
	ScrollText,
	Search,
	ShieldCheck,
	Sparkles,
	Tags,
	Terminal,
} from "lucide-react";
import { Suspense, lazy, useEffect } from "react";
import { useT } from "../../i18n";
import type { MessageKey } from "../../i18n";
import {
	type SettingsTab,
	isDeveloperSettingsTab,
	useSettingsStore,
} from "../../stores/settingsStore";
import AppearancePanel from "./AppearancePanel";
import ContextMenuPanel from "./ContextMenuPanel";
import ContextPanelSettings from "./ContextPanelSettings";
import DataPanel from "./DataPanel";
import GroupChatSettingsPanel from "./GroupChatSettingsPanel";
import KnowledgePanel from "./KnowledgePanel";
import MemoryPanel from "./MemoryPanel";
import ModelMetadataPanel from "./ModelMetadataPanel";
import ProvidersPanel from "./ProvidersPanel";
import SecurityPanel from "./SecurityPanel";
import SkillsPanel from "./SkillsPanel";
import UsagePanel from "./UsagePanel";
import { runAfterSettingsLeaveGuard } from "./settingsLeaveGuard";

const DeveloperPanel = lazy(() => import("./DeveloperPanel"));
const ProcessesPanel = lazy(() => import("./ProcessesPanel"));
const LogsPanel = lazy(() => import("./LogsPanel"));
const DatabasePanel = lazy(() => import("./DatabasePanel"));
const AboutPanel = lazy(() => import("./AboutPanel"));
const SearchPanel = lazy(() => import("./SearchPanel"));
const TokenModelsPanel = lazy(() => import("./TokenModelsPanel"));

interface TabDefinition {
	id: SettingsTab;
	labelKey: MessageKey;
	icon: typeof Bot;
}

interface TabGroup {
	labelKey: MessageKey;
	tabs: TabDefinition[];
}

const TAB_GROUPS: TabGroup[] = [
	{
		labelKey: "settings.groupInterface",
		tabs: [
			{ id: "appearance", labelKey: "settings.appearance", icon: Palette },
			{ id: "context-panel", labelKey: "settings.contextPanel", icon: Gauge },
			{
				id: "context-menu",
				labelKey: "settings.contextMenu",
				icon: MousePointer2,
			},
		],
	},
	{
		labelKey: "settings.groupAi",
		tabs: [
			{ id: "providers", labelKey: "settings.providers", icon: Bot },
			{
				id: "model-metadata",
				labelKey: "settings.modelMetadata",
				icon: Tags,
			},
			{ id: "search", labelKey: "settings.webSearch", icon: Search },
			{
				id: "group-chat",
				labelKey: "settings.groupChat",
				icon: MessagesSquare,
			},
			{ id: "skills", labelKey: "settings.skills", icon: Sparkles },
			{ id: "usage", labelKey: "settings.usage", icon: ChartNoAxesColumn },
		],
	},
	{
		labelKey: "settings.groupData",
		tabs: [
			{ id: "data", labelKey: "settings.data", icon: FolderArchive },
			{ id: "knowledge", labelKey: "settings.knowledge", icon: Database },
			{ id: "memories", labelKey: "settings.memories", icon: BookOpen },
			{ id: "security", labelKey: "settings.security", icon: ShieldCheck },
		],
	},
	{
		labelKey: "settings.groupSystem",
		tabs: [{ id: "about", labelKey: "settings.about", icon: Info }],
	},
];

const DEV_TABS: TabDefinition[] = [
	{ id: "developer", labelKey: "settings.developer", icon: Terminal },
	{ id: "processes", labelKey: "settings.processes", icon: Cpu },
	{ id: "logs", labelKey: "settings.logs", icon: ScrollText },
	{ id: "database", labelKey: "settings.database", icon: Database },
	{ id: "token-models", labelKey: "settings.tokenModels", icon: Gauge },
];

const FULL_BLEED_TABS: readonly SettingsTab[] = [
	"providers",
	"model-metadata",
	"processes",
	"logs",
	"database",
	"usage",
	"memories",
	"search",
	"data",
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
	const t = useT();
	const tab = useSettingsStore((s) => s.settingsTab);
	const setTab = useSettingsStore((s) => s.openSettings);
	const devMode = useSettingsStore((s) => s.devMode);
	const tabLabels = Object.fromEntries(
		[...TAB_GROUPS.flatMap((group) => group.tabs), ...DEV_TABS].map((item) => [
			item.id,
			t(item.labelKey),
		]),
	) as Record<SettingsTab, string>;

	const tabGroups = TAB_GROUPS.map((group) =>
		group.labelKey === "settings.groupSystem" && devMode
			? { ...group, tabs: [...group.tabs, ...DEV_TABS] }
			: group,
	);
	const selectTab = (nextTab: SettingsTab) => {
		if (nextTab === tab) return;
		runAfterSettingsLeaveGuard(() => setTab(nextTab));
	};

	useEffect(() => {
		if (!devMode && isDeveloperSettingsTab(tab)) setTab("about");
	}, [devMode, setTab, tab]);

	return (
		<section
			aria-label={t("settings.title")}
			className="flex h-full min-h-0 w-full overflow-hidden bg-workspace text-text-primary"
		>
			<aside className="flex w-52 shrink-0 flex-col overflow-y-auto border-r border-border bg-surface-alt p-3 max-[760px]:w-14 max-[760px]:px-2">
				<div className="mb-4 px-2 text-sm font-semibold text-text-primary max-[760px]:hidden">
					{t("settings.title")}
				</div>
				<nav aria-label={t("settings.sections")} className="space-y-3">
					{tabGroups.map((group) => (
						<fieldset key={group.labelKey} className="m-0 min-w-0 border-0 p-0">
							<legend className="mb-1 w-full px-2 text-[10px] font-semibold text-text-muted max-[760px]:sr-only">
								{t(group.labelKey)}
							</legend>
							{group.tabs.map((item) => (
								<button
									key={item.id}
									type="button"
									onClick={() => selectTab(item.id)}
									aria-current={tab === item.id ? "page" : undefined}
									title={t(item.labelKey)}
									className={`mb-0.5 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors max-[760px]:justify-center max-[760px]:px-2 ${
										tab === item.id
											? "bg-selected text-text-primary"
											: "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
									}`}
								>
									<item.icon className="h-4 w-4 shrink-0" />
									<span className="truncate max-[760px]:hidden">
										{t(item.labelKey)}
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
						{tabLabels[tab]}
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
					{tab === "model-metadata" && <ModelMetadataPanel />}
					{tab === "skills" && <SkillsPanel />}
					{tab === "usage" && <UsagePanel />}
					{tab === "group-chat" && <GroupChatSettingsPanel />}
					{tab === "search" && (
						<Suspense
							fallback={<LoadingPanel label={t("settings.loadingSearch")} />}
						>
							<SearchPanel />
						</Suspense>
					)}
					{tab === "knowledge" && <KnowledgePanel />}
					{tab === "data" && <DataPanel />}
					{tab === "memories" && <MemoryPanel />}
					{tab === "security" && <SecurityPanel />}
					{tab === "appearance" && <AppearancePanel />}
					{tab === "context-panel" && <ContextPanelSettings />}
					{tab === "context-menu" && <ContextMenuPanel />}
					{tab === "about" && (
						<Suspense
							fallback={<LoadingPanel label={t("settings.loadingAbout")} />}
						>
							<AboutPanel />
						</Suspense>
					)}
					{tab === "developer" && (
						<Suspense
							fallback={<LoadingPanel label={t("settings.loadingDeveloper")} />}
						>
							<DeveloperPanel />
						</Suspense>
					)}
					{tab === "processes" && (
						<Suspense
							fallback={<LoadingPanel label={t("settings.loadingProcesses")} />}
						>
							<ProcessesPanel />
						</Suspense>
					)}
					{tab === "logs" && (
						<Suspense
							fallback={<LoadingPanel label={t("settings.loadingLogs")} />}
						>
							<LogsPanel />
						</Suspense>
					)}
					{tab === "database" && (
						<Suspense
							fallback={<LoadingPanel label={t("settings.loadingDatabase")} />}
						>
							<DatabasePanel />
						</Suspense>
					)}
					{tab === "token-models" && (
						<Suspense
							fallback={
								<LoadingPanel label={t("settings.loadingTokenModels")} />
							}
						>
							<TokenModelsPanel />
						</Suspense>
					)}
				</div>
			</div>
		</section>
	);
}
