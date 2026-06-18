import type { ProviderProtocol } from "../services/providers";

/**
 * Provider profiles are now dynamic — fetched from the gateway and held in
 * `useProviderStore`. This module only retains small presentation helpers.
 */

/** Placeholder/hint for the API key input, by protocol. */
export function keyHintFor(protocol: ProviderProtocol): string {
	switch (protocol) {
		case "anthropic":
			return "sk-ant-...";
		default:
			return "sk-...";
	}
}
