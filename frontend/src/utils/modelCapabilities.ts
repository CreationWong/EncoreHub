import type {
	ProviderModelCapability,
	ProviderProfile,
} from "../services/providers";

export function modelHasCapability(
	profiles: ProviderProfile[],
	providerId: string,
	modelId: string,
	capability: ProviderModelCapability,
): boolean {
	const profile = profiles.find((item) => item.id === providerId);
	const model = profile?.model_configs?.find((item) => item.id === modelId);
	return model?.capabilities?.includes(capability) ?? false;
}
