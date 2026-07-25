import { Bot } from "lucide-react";
import { useConversationStore } from "../../stores/conversationStore";
import { useProviderStore } from "../../stores/providerStore";
import { useSettingsStore } from "../../stores/settingsStore";

function newestConversation<T extends { updated_at: string }>(
	items: T[],
): T | null {
	return (
		[...items].sort(
			(left, right) =>
				Date.parse(right.updated_at) - Date.parse(left.updated_at),
		)[0] ?? null
	);
}

export default function CharacterList() {
	const provider = useSettingsStore((state) => state.provider);
	const model = useSettingsStore((state) => state.model);
	const profiles = useProviderStore((state) => state.profiles);
	const providerLoading = useProviderStore((state) => state.loading);
	const providerError = useProviderStore((state) => state.error);
	const conversations = useConversationStore((state) => state.conversations);
	const activeId = useConversationStore((state) => state.activeId);
	const selectConversation = useConversationStore(
		(state) => state.selectConversation,
	);
	const newConversation = useConversationStore(
		(state) => state.newConversation,
	);
	const selectedProvider = profiles.find((item) => item.id === provider);
	const matchingConversations = conversations.filter(
		(item) => item.provider === provider && item.model === model,
	);
	const recentConversation = newestConversation(matchingConversations);
	const activeConversation = conversations.find((item) => item.id === activeId);
	const selected = Boolean(
		!activeConversation ||
			(activeConversation.provider === provider &&
				activeConversation.model === model),
	);

	const detail = providerError
		? "Provider configuration unavailable"
		: providerLoading && !selectedProvider
			? "Loading provider"
			: selectedProvider
				? `${selectedProvider.name} · ${model || "Default model"}`
				: "No provider selected";

	const activate = async () => {
		if (recentConversation) {
			await selectConversation(recentConversation.id);
			return;
		}
		await newConversation();
	};

	return (
		<div className="h-full overflow-y-auto p-2" aria-label="Characters">
			<button
				type="button"
				onClick={() => void activate()}
				aria-current={selected ? "true" : undefined}
				className={`flex min-h-[58px] w-full items-center gap-3 rounded-md border px-2.5 py-2 text-left transition-colors ${
					selected
						? "border-border bg-selected"
						: "border-transparent hover:bg-control"
				}`}
			>
				<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-control text-text-secondary">
					<Bot className="h-4 w-4" />
				</span>
				<span className="min-w-0 flex-1">
					<span className="block truncate text-sm font-medium text-text-primary">
						Default character
					</span>
					<span
						className="mt-0.5 block truncate text-[11px] text-text-muted"
						title={detail}
					>
						{detail}
					</span>
				</span>
			</button>
		</div>
	);
}
