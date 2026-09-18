// Encrypted API-key pool payload for a provider profile.

import { t } from "../../i18n";

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

/** Default display name for a pool slot; `index` is zero-based. */
function defaultKeyName(index: number): string {
	return index === 0
		? t("providers.primary")
		: t("providers.backup", { index });
}

/** Create an empty enabled key. `index` is one-based (first key is Primary). */
export function createProviderAPIKey(index: number): ProviderAPIKey {
	return {
		id: `key-${Date.now().toString(36)}-${index}`,
		name: defaultKeyName(index - 1),
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
							: defaultKeyName(index),
					value: key.value,
					enabled: key.enabled,
				}));
		}
	} catch {
		// A normal provider key is not JSON; it falls through to legacy mode.
	}
	return [
		{ id: "primary", name: defaultKeyName(0), value: trimmed, enabled: true },
	];
}

/** Trim values and fill empty names with the current-locale defaults. */
export function normalizeProviderAPIKeys(
	keys: ProviderAPIKey[],
): ProviderAPIKey[] {
	return keys.map((key, index) => ({
		...key,
		id: key.id.trim(),
		name: key.name.trim() || defaultKeyName(index),
		value: key.value.trim(),
	}));
}

/** Encode the versioned key-pool envelope for the secrets vault. */
export function serializeProviderAPIKeys(keys: ProviderAPIKey[]): string {
	const envelope: ProviderAPIKeyEnvelope = {
		version: 1,
		keys: normalizeProviderAPIKeys(keys),
	};
	return JSON.stringify(envelope);
}

/** Stable comparison key for draft-vs-persisted pool equality. */
export function providerAPIKeySignature(keys: ProviderAPIKey[]): string {
	return JSON.stringify(normalizeProviderAPIKeys(keys));
}
