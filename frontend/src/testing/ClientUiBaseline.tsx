import ChatView from "../components/chat/ChatView";
import SettingsModal from "../components/settings/SettingsModal";
import Sidebar from "../components/sidebar/Sidebar";
import { useConversationStore } from "../stores/conversationStore";
import { useProviderStore } from "../stores/providerStore";
import { useSecretsStore } from "../stores/secretsStore";
import { useSettingsStore } from "../stores/settingsStore";
import {
	CLIENT_UI_BASELINE_CONVERSATIONS,
	CLIENT_UI_BASELINE_PROVIDERS,
	type ClientUiBaselineOptions,
	getClientUiScenario,
} from "./clientUiFixtures";

export function seedClientUiBaseline({
	scenarioId,
	theme,
}: ClientUiBaselineOptions) {
	const scenario = getClientUiScenario(scenarioId);
	const selectedConversation = CLIENT_UI_BASELINE_CONVERSATIONS.find(
		(item) => item.id === scenario.activeId,
	);

	document.documentElement.classList.toggle("dark", theme === "dark");
	document.documentElement.dataset.uiBaselineTheme = theme;
	document.body.dataset.uiBaselineScenario = scenario.id;

	useSettingsStore.setState({
		theme,
		provider: selectedConversation?.provider ?? scenario.provider,
		model: selectedConversation?.model ?? scenario.model,
		apiKeys: {},
		sidebarOpen: true,
		sidebarWidth: 256,
		settingsOpen: scenario.settingsOpen,
		settingsTab: "providers",
		devMode: false,
		searchEnabled: scenario.searchEnabled,
		searchProvider: "duckduckgo",
		setApiKey: () => {},
		clearApiKey: async () => {},
		loadKeys: async () => {},
	});

	useProviderStore.setState({
		profiles: CLIENT_UI_BASELINE_PROVIDERS.map((profile) => ({
			...profile,
			models: [...profile.models],
		})),
		loading: false,
		loaded: true,
		error: null,
		load: async () => {},
		save: async () => {},
		upsert: async () => {},
		remove: async () => {},
	});

	useSecretsStore.setState({
		encrypted: scenario.vaultLocked,
		unlocked: false,
		storedIds: scenario.vaultLocked ? ["deepseek"] : [],
		loaded: true,
		loading: false,
		refresh: async () => {},
		enable: async () => {},
		disable: async () => {},
		unlock: async () => {},
		lock: async () => {},
		resetPassword: async () => {},
		clear: async () => {},
	});

	useConversationStore.setState({
		conversations: CLIENT_UI_BASELINE_CONVERSATIONS.map((conversation) => ({
			...conversation,
		})),
		activeId: scenario.activeId,
		messages: scenario.messages,
		loading: false,
		streaming: scenario.streaming,
		streamingContent: scenario.streamingContent,
		streamingReasoning: scenario.streamingReasoning,
		streamingToolCalls: scenario.streamingToolCalls,
		error: null,
		abortController: null,
		pendingDraft: null,
		convCache: {},
		loadList: async () => {},
		selectConversation: async () => {},
		newConversation: async () => scenario.activeId ?? "baseline-new",
		deleteConversation: async () => {},
		renameConversation: async () => {},
		sendMessage: async () => {},
		stopStreaming: () => {
			useConversationStore.setState({ streaming: false });
		},
		pushSystemMessage: () => {},
		setDraft: (content) => {
			useConversationStore.setState({ pendingDraft: content });
		},
		clearDraft: () => {
			useConversationStore.setState({ pendingDraft: null });
		},
		clearError: () => {
			useConversationStore.setState({ error: null });
		},
		generateTitle: async () => {},
	});

	return scenario;
}

export default function ClientUiBaseline() {
	return (
		<>
			<div className="flex h-screen overflow-hidden bg-surface text-text-primary">
				<Sidebar />
				<main className="flex min-w-0 flex-1 flex-col">
					<ChatView />
				</main>
			</div>
			<SettingsModal />
		</>
	);
}
