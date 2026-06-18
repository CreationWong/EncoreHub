import { apiFetch } from "./api";

/** Wire protocol the gateway uses to talk to a provider. */
export type ProviderProtocol = "openai" | "anthropic";

/**
 * A provider profile as persisted by the gateway/engine. Mirrors the Go
 * `provider.ProviderProfile`. Never contains an API key — keys are supplied
 * per-request via the X-Provider-Key header and stored separately.
 */
export interface ProviderProfile {
	id: string;
	name: string;
	protocol: ProviderProtocol;
	/** Empty for the builtin OpenAI profile (SDK default endpoint). */
	base_url: string;
	models: string[];
	enabled: boolean;
	/** Builtin profiles are editable but cannot be deleted. */
	builtin: boolean;
}

interface ProvidersResponse {
	providers: ProviderProfile[];
}

export const providersApi = {
	/** List all provider profiles (builtin-first). */
	list(): Promise<ProvidersResponse> {
		return apiFetch<ProvidersResponse>("/providers");
	},

	/**
	 * Replace the entire profile list. The gateway validates, persists to the
	 * engine, and rebuilds its live adapter registry. Returns the canonical
	 * list after the update.
	 */
	update(providers: ProviderProfile[]): Promise<ProvidersResponse> {
		return apiFetch<ProvidersResponse>("/providers", {
			method: "PUT",
			body: JSON.stringify({ providers }),
		});
	},
};
