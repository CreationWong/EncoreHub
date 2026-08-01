import {
	type NormalizedModelMetadata,
	applyMetadataToModelConfig,
	discoveredModelMetadata,
} from "../../services/modelMetadata";
import type {
	DiscoveredModel,
	ProviderModelConfig,
} from "../../services/providers";
import { defaultModelConfig } from "./providerConfig";

export interface ProviderModelDiscoveryDiff {
	additions: ProviderModelConfig[];
	retained: ProviderModelConfig[];
	removals: ProviderModelConfig[];
	nextModels: ProviderModelConfig[];
	removalsWithheld: boolean;
	selectionRequired: boolean;
	owners: string[];
}

export function buildProviderModelDiscoveryDiff(
	currentModels: ProviderModelConfig[],
	remoteModels: DiscoveredModel[],
	allowRemovals: boolean,
	metadataForModel?: (
		model: DiscoveredModel,
	) => NormalizedModelMetadata | undefined,
): ProviderModelDiscoveryDiff {
	const currentByID = new Map(currentModels.map((model) => [model.id, model]));
	const seenRemote = new Set<string>();
	const normalizedRemote = remoteModels.filter((model) => {
		const id = model.id.trim();
		if (!id || seenRemote.has(id)) return false;
		seenRemote.add(id);
		return true;
	});
	const remoteIDs = new Set(normalizedRemote.map((model) => model.id.trim()));
	const remoteConfigs = normalizedRemote.map((model) => {
		const id = model.id.trim();
		const base =
			currentByID.get(id) ??
			defaultModelConfig(
				id,
				model.name.trim() || id,
				model.owned_by?.trim() || "Discovered",
			);
		const fromDiscovery = applyMetadataToModelConfig(
			base,
			discoveredModelMetadata(model),
		);
		const catalogMetadata = metadataForModel?.(model);
		return catalogMetadata
			? applyMetadataToModelConfig(fromDiscovery, catalogMetadata)
			: fromDiscovery;
	});
	const additions = remoteConfigs.filter((model) => !currentByID.has(model.id));
	const retained = remoteConfigs.filter((model) => currentByID.has(model.id));
	const localOnly = currentModels.filter((model) => !remoteIDs.has(model.id));
	const remoteConfigByID = new Map(
		remoteConfigs.map((model) => [model.id, model]),
	);
	const nextModels = allowRemovals
		? remoteConfigs
		: [
				...currentModels.map(
					(model) => remoteConfigByID.get(model.id) ?? model,
				),
				...additions,
			];
	const owners = [
		...new Set(
			normalizedRemote
				.map((model) => model.owned_by?.trim())
				.filter((owner): owner is string => Boolean(owner)),
		),
	];

	return {
		additions,
		retained,
		removals: allowRemovals ? localOnly : [],
		nextModels,
		removalsWithheld: !allowRemovals && localOnly.length > 0,
		selectionRequired: normalizedRemote.length >= 10 || owners.length >= 2,
		owners,
	};
}

export function modelsForSelectedAdditions(
	diff: ProviderModelDiscoveryDiff,
	selectedIds: ReadonlySet<string>,
): ProviderModelConfig[] {
	const additionIDs = new Set(diff.additions.map((model) => model.id));
	return diff.nextModels.filter(
		(model) => !additionIDs.has(model.id) || selectedIds.has(model.id),
	);
}
