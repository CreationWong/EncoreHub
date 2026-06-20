import { apiFetch } from "./api";

/**
 * Encryption status reported by the engine.
 * - `encrypted`: the secrets database is in encrypted mode.
 * - `unlocked`: a master key is currently cached (only meaningful when encrypted).
 */
export interface SecretsStatus {
	encrypted: boolean;
	unlocked: boolean;
}

interface SecretsListResponse {
	provider_ids: string[];
}

/**
 * Secrets API — provider API-key storage with optional master-password
 * encryption. Proxied through the gateway to the engine (`/api/secrets/*`).
 *
 * Passwords and keys are sent over the localhost trust boundary, the same one
 * the X-Provider-Key header already uses. Never log the values passed here.
 */
export const secretsApi = {
	/** Current encryption + unlock state. */
	status(): Promise<SecretsStatus> {
		return apiFetch<SecretsStatus>("/secrets/status");
	},

	/** Provider ids that have a stored key (values never returned in bulk). */
	list(): Promise<SecretsListResponse> {
		return apiFetch<SecretsListResponse>("/secrets");
	},

	/** Store/replace one provider key. Encrypts when in encrypted mode. */
	putKey(providerId: string, key: string): Promise<void> {
		return apiFetch<void>("/secrets", {
			method: "PUT",
			body: JSON.stringify({ provider_id: providerId, key }),
		});
	},

	/** Remove a stored key. */
	deleteKey(providerId: string): Promise<void> {
		return apiFetch<void>(`/secrets/${encodeURIComponent(providerId)}`, {
			method: "DELETE",
		});
	},

	/**
	 * Turn on encryption with a new master password. Existing plaintext keys
	 * (plus any `keys` seeded here, e.g. session keys) are encrypted at rest.
	 * The session is unlocked on success.
	 */
	enable(password: string, keys: Record<string, string> = {}): Promise<void> {
		return apiFetch<void>("/secrets/enable", {
			method: "POST",
			body: JSON.stringify({ password, keys }),
		});
	},

	/** Verify password and decrypt all keys back to plaintext (encryption off). */
	disable(password: string): Promise<void> {
		return apiFetch<void>("/secrets/disable", {
			method: "POST",
			body: JSON.stringify({ password }),
		});
	},

	/** Unlock the database for this session (caches the derived master key). */
	unlock(password: string): Promise<void> {
		return apiFetch<void>("/secrets/unlock", {
			method: "POST",
			body: JSON.stringify({ password }),
		});
	},

	/** Drop the cached master key (re-lock). */
	lock(): Promise<void> {
		return apiFetch<void>("/secrets/lock", { method: "POST" });
	},

	/** Verify the old password, then re-encrypt all keys under a new one. */
	resetPassword(oldPassword: string, newPassword: string): Promise<void> {
		return apiFetch<void>("/secrets/reset-password", {
			method: "POST",
			body: JSON.stringify({
				old_password: oldPassword,
				new_password: newPassword,
			}),
		});
	},

	/** Wipe all keys + crypto metadata. Used when the password is forgotten. */
	clear(): Promise<void> {
		return apiFetch<void>("/secrets/clear", { method: "POST" });
	},
};
