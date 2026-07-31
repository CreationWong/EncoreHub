import CharacterManager from "../components/character/CharacterManager";
import GlobalNav from "../components/layout/GlobalNav";
import AppContextMenu from "../components/ui/AppContextMenu";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import ToastHost from "../components/ui/ToastHost";
import WorkspaceSurface from "../components/workspace/WorkspaceSurface";
import type { CharacterHistoryListResponse } from "../services/characters";
import { DEFAULT_WEB_SEARCH_SETTINGS } from "../services/webSearch";
import { useCharacterManagerStore } from "../stores/characterManagerStore";
import { useCharacterStore } from "../stores/characterStore";
import { useConversationStore } from "../stores/conversationStore";
import { useProviderStore } from "../stores/providerStore";
import { useSecretsStore } from "../stores/secretsStore";
import { useSettingsStore } from "../stores/settingsStore";
import { isDeveloperSettingsTab } from "../stores/settingsStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import {
	CLIENT_UI_BASELINE_CHARACTERS,
	CLIENT_UI_BASELINE_CONVERSATIONS,
	CLIENT_UI_BASELINE_PROVIDERS,
	type ClientUiBaselineOptions,
	getClientUiScenario,
} from "./clientUiFixtures";

async function loadClientUiCharacterHistories(): Promise<CharacterHistoryListResponse> {
	const histories = CLIENT_UI_BASELINE_CHARACTERS.map((character) => ({
		character: { ...character, tags: [...character.tags] },
		branches: [
			{
				character_id: character.id,
				name: character.active_branch,
				head_version: character.version,
				created_from_version: 1,
				created_at: character.created_at,
				updated_at: character.updated_at,
			},
		],
		versions: Array.from({ length: character.version }, (_, index) => {
			const version = index + 1;
			return {
				character_id: character.id,
				version,
				parent_version: version === 1 ? null : version - 1,
				branch_name: character.active_branch,
				message:
					version === 1
						? "Initial version"
						: version === character.version
							? "Current baseline version"
							: `Version ${version}`,
				name: character.name,
				avatar: character.avatar,
				description: character.description,
				system_prompt: character.system_prompt,
				opening_message: character.opening_message,
				tags: [...character.tags],
				default_provider: character.default_provider,
				default_model: character.default_model,
				created_at: character.updated_at,
			};
		}),
	}));
	return { histories, total: histories.length };
}

export function seedClientUiBaseline({
	scenarioId,
	theme,
	sidebar,
	settingsTab,
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
		sidebarOpen: sidebar !== "closed",
		sidebarWidth: 300,
		sidebarMode: sidebar === "characters" ? "characters" : "conversations",
		settingsTab: settingsTab ?? "providers",
		devMode: settingsTab !== null && isDeveloperSettingsTab(settingsTab),
		fullCommunicationLogs: false,
		searchEnabled: scenario.searchEnabled,
		searchProvider: "duckduckgo",
		searchMaxResults: DEFAULT_WEB_SEARCH_SETTINGS.max_results,
		googleSearchEngineId: "",
		customSearchSettings: { ...DEFAULT_WEB_SEARCH_SETTINGS.custom },
		searchSettingsLoaded: true,
		setApiKey: () => {},
		clearApiKey: async () => {},
		loadKeys: async () => {},
		loadWebSearchSettings: async () => {},
		saveWebSearchSettings: async () => {},
	});
	const settingsActive = scenario.settingsOpen || settingsTab !== null;
	useWorkspaceStore.setState({
		activeTab: settingsActive ? "settings" : "home",
		openTabs: settingsActive ? ["home", "settings"] : ["home"],
	});

	useProviderStore.setState({
		profiles: CLIENT_UI_BASELINE_PROVIDERS.filter(
			(profile) =>
				!scenario.unavailableProvider ||
				profile.id !== selectedConversation?.provider,
		).map((profile) => ({
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
		listLoading: false,
		listError: null,
		messages: scenario.messages,
		loading: false,
		streaming: scenario.streaming,
		streamingContent: scenario.streamingContent,
		streamingReasoning: scenario.streamingReasoning,
		streamingDurationMs: scenario.streaming ? 1840 : 0,
		streamingToolCalls: scenario.streamingToolCalls,
		error: null,
		abortController: null,
		pendingDraft: null,
		drafts: {},
		scrollPositions: {},
		convCache: {},
		prefetchedConversationIds: {},
		loadList: async () => {},
		prefetchConversation: async () => {},
		releaseConversationPrefetch: () => {},
		selectConversation: async () => {},
		newConversation: async () => scenario.activeId ?? "baseline-new",
		deleteConversation: async () => {},
		renameConversation: async () => {},
		updateConversationModel: async () => {},
		upgradeConversationCharacter: async (id) =>
			CLIENT_UI_BASELINE_CONVERSATIONS.find((item) => item.id === id) ??
			CLIENT_UI_BASELINE_CONVERSATIONS[0],
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

	useCharacterStore.setState({
		characters: CLIENT_UI_BASELINE_CHARACTERS.map((character) => ({
			...character,
			tags: [...character.tags],
		})),
		loading: false,
		loaded: true,
		error: null,
		load: async () => {},
		create: async (input) => {
			const character = {
				...CLIENT_UI_BASELINE_CHARACTERS[1],
				...input,
				id: "baseline-created",
				avatar: input.avatar ?? "",
				description: input.description ?? "",
				system_prompt: input.system_prompt ?? "",
				default_provider: input.default_provider ?? "",
				default_model: input.default_model ?? "",
				opening_message: input.opening_message ?? "",
				tags: input.tags ?? [],
				version: 1,
			};
			useCharacterStore.setState((state) => ({
				characters: [...state.characters, character],
			}));
			return character;
		},
		update: async (id, changes) => {
			const current = useCharacterStore
				.getState()
				.characters.find((item) => item.id === id);
			if (!current) throw new Error("Character not found");
			const updated = {
				...current,
				...changes,
				revision: current.revision + 1,
				updated_at: new Date().toISOString(),
			};
			useCharacterStore.setState((state) => ({
				characters: state.characters.map((item) =>
					item.id === id ? updated : item,
				),
			}));
			return updated;
		},
		remove: async (id) => {
			useCharacterStore.setState((state) => ({
				characters: state.characters.filter((item) => item.id !== id),
			}));
		},
		clearError: () => useCharacterStore.setState({ error: null }),
	});

	useCharacterManagerStore.setState({
		open: false,
		characterId: null,
		creating: false,
	});

	return scenario;
}

export default function ClientUiBaseline() {
	return (
		<>
			<div className="flex h-screen min-h-0 flex-col overflow-hidden bg-app-canvas text-text-primary">
				<GlobalNav />
				<WorkspaceSurface />
			</div>
			<CharacterManager historyLoader={loadClientUiCharacterHistories} />
			<ConfirmDialog />
			<ToastHost />
			<AppContextMenu />
		</>
	);
}
