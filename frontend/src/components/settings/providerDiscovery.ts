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
}

export function buildProviderModelDiscoveryDiff(
	currentModels: ProviderModelConfig[],
	remoteModels: DiscoveredModel[],
	allowRemovals: boolean,
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
	const additions = normalizedRemote
		.filter((model) => !currentByID.has(model.id.trim()))
		.map((model) =>
			defaultModelConfig(
				model.id.trim(),
				model.name.trim() || model.id.trim(),
				"Discovered",
			),
		);
	const retained = currentModels.filter((model) => remoteIDs.has(model.id));
	const localOnly = currentModels.filter((model) => !remoteIDs.has(model.id));
	const nextModels = allowRemovals
		? normalizedRemote.map(
				(model) =>
					currentByID.get(model.id.trim()) ??
					defaultModelConfig(
						model.id.trim(),
						model.name.trim() || model.id.trim(),
						"Discovered",
					),
			)
		: [...currentModels, ...additions];

	return {
		additions,
		retained,
		removals: allowRemovals ? localOnly : [],
		nextModels,
		removalsWithheld: !allowRemovals && localOnly.length > 0,
	};
}
