import { AlertTriangle, Loader2, Pencil, Plus, RefreshCw } from "lucide-react";
import { useEffect } from "react";
import {
	type CharacterProfile,
	DEFAULT_CHARACTER_ID,
} from "../../services/characters";
import type { Conversation } from "../../services/conversation";
import {
	type ProviderProfile,
	providerChatModels,
} from "../../services/providers";
import { useCharacterManagerStore } from "../../stores/characterManagerStore";
import { useCharacterStore } from "../../stores/characterStore";
import { useConversationStore } from "../../stores/conversationStore";
import { useProviderStore } from "../../stores/providerStore";
import { useSettingsStore } from "../../stores/settingsStore";
import CharacterAvatar from "../character/CharacterAvatar";

function newestConversation(items: Conversation[]): Conversation | null {
	return (
		[...items].sort(
			(left, right) =>
				Date.parse(right.updated_at) - Date.parse(left.updated_at),
		)[0] ?? null
	);
}

function conversationCharacterId(conversation: Conversation): string {
	return conversation.character_id || DEFAULT_CHARACTER_ID;
}

function modelName(provider: ProviderProfile, modelId: string): string {
	return (
		provider.model_configs
			?.find((model) => model.id === modelId)
			?.name?.trim() || modelId
	);
}

function modelAvailable(
	provider: ProviderProfile | undefined,
	modelId: string,
): boolean {
	return Boolean(
		provider?.enabled && providerChatModels(provider).includes(modelId),
	);
}

function characterModel(
	character: CharacterProfile,
	appProvider: string,
	appModel: string,
): { provider: string; model: string } {
	return {
		provider: character.default_provider || appProvider,
		model: character.default_model || appModel,
	};
}

export default function CharacterList() {
	const characters = useCharacterStore((state) => state.characters);
	const loading = useCharacterStore((state) => state.loading);
	const loaded = useCharacterStore((state) => state.loaded);
	const error = useCharacterStore((state) => state.error);
	const load = useCharacterStore((state) => state.load);
	const profiles = useProviderStore((state) => state.profiles);
	const appProvider = useSettingsStore((state) => state.provider);
	const appModel = useSettingsStore((state) => state.model);
	const conversations = useConversationStore((state) => state.conversations);
	const activeId = useConversationStore((state) => state.activeId);
	const selectConversation = useConversationStore(
		(state) => state.selectConversation,
	);
	const newConversation = useConversationStore(
		(state) => state.newConversation,
	);
	const openCharacter = useCharacterManagerStore(
		(state) => state.openCharacter,
	);
	const createCharacter = useCharacterManagerStore(
		(state) => state.createCharacter,
	);
	const activeConversation = conversations.find((item) => item.id === activeId);

	useEffect(() => {
		if (!loaded && !loading) void load();
	}, [load, loaded, loading]);

	const activate = async (character: CharacterProfile) => {
		const recentConversation = newestConversation(
			conversations.filter(
				(item) => conversationCharacterId(item) === character.id,
			),
		);
		if (recentConversation) {
			await selectConversation(recentConversation.id);
			return;
		}
		const selection = characterModel(character, appProvider, appModel);
		await newConversation({
			characterId: character.id,
			...(selection.provider && selection.model ? selection : {}),
		});
	};

	return (
		<section className="flex h-full min-h-0 flex-col" aria-label="Characters">
			<header className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3">
				<span className="text-[11px] font-medium text-text-muted">
					{characters.length === 1
						? "1 character"
						: `${characters.length} characters`}
				</span>
				<button
					type="button"
					onClick={createCharacter}
					aria-label="Add character"
					title="Add character"
					className="flex h-8 w-8 items-center justify-center rounded-md text-text-secondary hover:bg-control hover:text-text-primary"
				>
					<Plus className="h-4 w-4" />
				</button>
			</header>

			<div className="min-h-0 flex-1 overflow-y-auto p-2">
				{loading && characters.length === 0 && (
					<output
						aria-label="Loading characters"
						className="flex h-28 items-center justify-center"
					>
						<Loader2 className="h-4 w-4 animate-spin text-text-muted" />
					</output>
				)}

				{error && characters.length === 0 && (
					<div className="px-4 py-8 text-center">
						<AlertTriangle className="mx-auto h-5 w-5 text-danger" />
						<p className="mt-2 text-xs text-danger">
							Unable to load characters.
						</p>
						<button
							type="button"
							onClick={() => void load()}
							className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-text-secondary hover:bg-control hover:text-text-primary"
						>
							<RefreshCw className="h-3.5 w-3.5" />
							Retry
						</button>
					</div>
				)}

				{!loading && !error && characters.length === 0 && (
					<div className="px-4 py-10 text-center">
						<p className="text-sm text-text-secondary">No characters yet.</p>
						<button
							type="button"
							onClick={createCharacter}
							className="mt-3 h-8 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover"
						>
							Add character
						</button>
					</div>
				)}

				{error && characters.length > 0 && (
					<div className="mb-2 flex items-center gap-2 rounded-md border border-warning-border bg-warning-bg px-2 py-2 text-[11px] text-warning">
						<AlertTriangle className="h-3.5 w-3.5 shrink-0" />
						<span className="min-w-0 flex-1 truncate">Refresh failed</span>
						<button
							type="button"
							onClick={() => void load()}
							aria-label="Retry loading characters"
							className="flex h-6 w-6 items-center justify-center rounded hover:bg-warning-bg"
						>
							<RefreshCw className="h-3 w-3" />
						</button>
					</div>
				)}

				<div className="space-y-1">
					{characters.map((character) => {
						const selection = characterModel(character, appProvider, appModel);
						const provider = profiles.find(
							(item) => item.id === selection.provider,
						);
						const available = modelAvailable(provider, selection.model);
						const selected = Boolean(
							activeConversation &&
								conversationCharacterId(activeConversation) === character.id,
						);
						const detail =
							selection.provider && selection.model
								? available && provider
									? `${provider.name} · ${modelName(provider, selection.model)}`
									: "Model unavailable"
								: "No model selected";

						return (
							<div
								key={character.id}
								className={`group flex min-h-[58px] items-center rounded-md border transition-colors ${
									selected
										? "border-border bg-selected"
										: "border-transparent hover:bg-control"
								}`}
							>
								<button
									type="button"
									onClick={() => void activate(character)}
									aria-current={selected ? "true" : undefined}
									className="flex min-w-0 flex-1 items-center gap-3 px-2.5 py-2 text-left focus-visible:rounded-md"
								>
									<CharacterAvatar
										avatar={character.avatar}
										characterId={character.id}
										name={character.name}
										size="large"
									/>
									<span className="min-w-0 flex-1">
										<span className="block truncate text-sm font-medium text-text-primary">
											{character.name}
										</span>
										<span
											title={detail}
											className={`mt-0.5 block truncate text-[11px] ${
												available ? "text-text-muted" : "text-warning"
											}`}
										>
											{detail}
										</span>
									</span>
								</button>
								<button
									type="button"
									onClick={() => openCharacter(character.id)}
									aria-label={`Edit ${character.name}`}
									title="Edit character"
									className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted opacity-0 hover:bg-surface-hover hover:text-text-primary focus:opacity-100 group-hover:opacity-100"
								>
									<Pencil className="h-3.5 w-3.5" />
								</button>
							</div>
						);
					})}
				</div>
			</div>
		</section>
	);
}
