import { type LucideIcon, MessageSquarePlus, Settings } from "lucide-react";
import { useConversationStore } from "../../stores/conversationStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";

interface LauncherItem {
	id: string;
	label: string;
	icon: LucideIcon;
	tone: string;
	onOpen: () => void | Promise<void>;
}

function LauncherGrid({
	label,
	items,
}: {
	label: string;
	items: LauncherItem[];
}) {
	return (
		<section aria-labelledby={`launcher-${label.toLowerCase()}`}>
			<h2
				id={`launcher-${label.toLowerCase()}`}
				className="mb-4 text-xs font-semibold text-text-secondary"
			>
				{label}
			</h2>
			<div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-x-5 gap-y-7">
				{items.map((item) => (
					<button
						key={item.id}
						type="button"
						onClick={() => void item.onOpen()}
						className="group flex h-32 min-w-0 flex-col items-center justify-start gap-2 rounded-md px-2 py-1 text-center text-sm font-medium text-text-primary transition-colors hover:bg-surface-hover"
					>
						<span
							className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-lg text-white shadow-[0_6px_14px_rgba(24,28,38,0.16)] transition-transform duration-150 group-hover:-translate-y-0.5 ${item.tone}`}
						>
							<item.icon className="h-7 w-7" strokeWidth={1.8} />
						</span>
						<span className="line-clamp-2 max-w-full leading-5">
							{item.label}
						</span>
					</button>
				))}
			</div>
		</section>
	);
}

export default function WorkspaceLauncher() {
	const newConversation = useConversationStore(
		(state) => state.newConversation,
	);
	const openSettings = useSettingsStore((state) => state.openSettings);
	const activateTab = useWorkspaceStore((state) => state.activateTab);

	const startItems: LauncherItem[] = [
		{
			id: "new-conversation",
			label: "New conversation",
			icon: MessageSquarePlus,
			tone: "bg-[#4263eb]",
			onOpen: async () => {
				const id = await newConversation();
				if (id) activateTab("home");
			},
		},
	];
	const toolItems: LauncherItem[] = [
		{
			id: "settings",
			label: "Settings",
			icon: Settings,
			tone: "bg-[#495057]",
			onOpen: () => openSettings(),
		},
	];

	return (
		<div className="h-full overflow-y-auto">
			<div className="mx-auto w-full max-w-6xl px-10 py-10 max-[700px]:px-5 max-[700px]:py-7">
				<h1 className="mb-8 text-lg font-semibold text-text-primary">
					Workbench
				</h1>
				<div className="space-y-10">
					<LauncherGrid label="Start" items={startItems} />
					<LauncherGrid label="Applications" items={toolItems} />
				</div>
			</div>
		</div>
	);
}
