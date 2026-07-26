export interface ProviderAPIKey {
	id: string;
	name: string;
	value: string;
	enabled: boolean;
}

interface ProviderAPIKeyEnvelope {
	version: 1;
	keys: ProviderAPIKey[];
}

export const MAX_PROVIDER_API_KEYS = 16;

export function createProviderAPIKey(index: number): ProviderAPIKey {
	return {
		id: `key-${Date.now().toString(36)}-${index}`,
		name: index === 1 ? "Primary" : `Backup ${index - 1}`,
		value: "",
		enabled: true,
	};
}

/** Decode the encrypted secret payload while keeping legacy single keys valid. */
export function parseProviderAPIKeys(raw: string): ProviderAPIKey[] {
	const trimmed = raw.trim();
	if (!trimmed) return [];
	try {
		const parsed = JSON.parse(trimmed) as Partial<ProviderAPIKeyEnvelope>;
		if (parsed.version === 1 && Array.isArray(parsed.keys)) {
			return parsed.keys
				.filter(
					(key): key is ProviderAPIKey =>
						typeof key?.id === "string" &&
						typeof key?.value === "string" &&
						typeof key?.enabled === "boolean",
				)
				.slice(0, MAX_PROVIDER_API_KEYS)
				.map((key, index) => ({
					id: key.id,
					name:
						typeof key.name === "string" && key.name.trim()
							? key.name
							: index === 0
								? "Primary"
								: `Backup ${index}`,
					value: key.value,
					enabled: key.enabled,
				}));
		}
	} catch {
		// A normal provider key is not JSON; it falls through to legacy mode.
	}
	return [{ id: "primary", name: "Primary", value: trimmed, enabled: true }];
}

export function normalizeProviderAPIKeys(
	keys: ProviderAPIKey[],
): ProviderAPIKey[] {
	return keys.map((key, index) => ({
		...key,
		id: key.id.trim(),
		name: key.name.trim() || (index === 0 ? "Primary" : `Backup ${index}`),
		value: key.value.trim(),
	}));
}

export function serializeProviderAPIKeys(keys: ProviderAPIKey[]): string {
	const envelope: ProviderAPIKeyEnvelope = {
		version: 1,
		keys: normalizeProviderAPIKeys(keys),
	};
	return JSON.stringify(envelope);
}

export function providerAPIKeySignature(keys: ProviderAPIKey[]): string {
	return JSON.stringify(normalizeProviderAPIKeys(keys));
}
