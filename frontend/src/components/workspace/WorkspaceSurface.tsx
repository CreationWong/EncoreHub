import { Loader2 } from "lucide-react";
import { Suspense, lazy } from "react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import ChatView from "../chat/ChatView";
import Sidebar from "../sidebar/Sidebar";

const SettingsWorkspace = lazy(() => import("../settings/SettingsModal"));
const WorkspaceLauncher = lazy(() => import("./WorkspaceLauncher"));

function WorkspaceLoading() {
	return (
		<output
			aria-label="Loading workspace"
			className="flex h-full items-center justify-center text-text-muted"
		>
			<Loader2 className="h-5 w-5 animate-spin" />
		</output>
	);
}

export default function WorkspaceSurface() {
	const activeTab = useWorkspaceStore((state) => state.activeTab);
	const openTabs = useWorkspaceStore((state) => state.openTabs);

	return (
		<div className="app-shell-body relative flex min-h-0 flex-1 gap-2 px-2 pb-2">
			<div
				data-workspace-tab="home"
				className={activeTab === "home" ? "contents" : "hidden"}
			>
				<Sidebar />
				<main className="min-w-0 flex-1 overflow-hidden rounded-lg border border-border bg-workspace">
					<ChatView />
				</main>
			</div>

			{openTabs.includes("settings") && (
				<main
					data-workspace-tab="settings"
					hidden={activeTab !== "settings"}
					className="min-w-0 flex-1 overflow-hidden rounded-lg border border-border bg-workspace"
				>
					<Suspense fallback={<WorkspaceLoading />}>
						<SettingsWorkspace />
					</Suspense>
				</main>
			)}

			{openTabs.includes("workbench") && (
				<main
					data-workspace-tab="workbench"
					hidden={activeTab !== "workbench"}
					className="min-w-0 flex-1 overflow-hidden rounded-lg border border-border bg-workspace"
				>
					<Suspense fallback={<WorkspaceLoading />}>
						<WorkspaceLauncher />
					</Suspense>
				</main>
			)}
		</div>
	);
}
