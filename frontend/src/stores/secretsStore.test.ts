import { beforeEach, describe, expect, it, vi } from "vitest";

// secretsApi is mocked so the store never touches the network.
const statusApi = vi.fn();
const enableApi = vi.fn();
const disableApi = vi.fn();
const unlockApi = vi.fn();
const lockApi = vi.fn();
const resetApi = vi.fn();
const clearApi = vi.fn();
vi.mock("../services/secrets", () => ({
	secretsApi: {
		status: (...a: unknown[]) => statusApi(...a),
		enable: (...a: unknown[]) => enableApi(...a),
		disable: (...a: unknown[]) => disableApi(...a),
		unlock: (...a: unknown[]) => unlockApi(...a),
		lock: (...a: unknown[]) => lockApi(...a),
		resetPassword: (...a: unknown[]) => resetApi(...a),
		clear: (...a: unknown[]) => clearApi(...a),
	},
}));

import { useSecretsStore } from "./secretsStore";

describe("secretsStore", () => {
	beforeEach(() => {
		for (const m of [
			statusApi,
			enableApi,
			disableApi,
			unlockApi,
			lockApi,
			resetApi,
			clearApi,
		]) {
			m.mockReset();
		}
		useSecretsStore.setState({
			encrypted: false,
			unlocked: false,
			loaded: false,
			loading: false,
		});
	});

	it("refresh populates encrypted/unlocked and sets loaded", async () => {
		statusApi.mockResolvedValue({ encrypted: true, unlocked: false });
		await useSecretsStore.getState().refresh();
		const s = useSecretsStore.getState();
		expect(s.encrypted).toBe(true);
		expect(s.unlocked).toBe(false);
		expect(s.loaded).toBe(true);
	});

	it("refresh swallows engine errors without throwing", async () => {
		statusApi.mockRejectedValue(new Error("engine down"));
		await expect(useSecretsStore.getState().refresh()).resolves.toBeUndefined();
		expect(useSecretsStore.getState().loading).toBe(false);
	});

	it("enable forwards password + seeded keys, then refreshes", async () => {
		enableApi.mockResolvedValue(undefined);
		statusApi.mockResolvedValue({ encrypted: true, unlocked: true });

		await useSecretsStore.getState().enable("pw", { openai: "sk-1" });

		expect(enableApi).toHaveBeenCalledWith("pw", { openai: "sk-1" });
		expect(useSecretsStore.getState().unlocked).toBe(true);
	});

	it("unlock propagates wrong-password errors to the caller", async () => {
		unlockApi.mockRejectedValue(new Error("incorrect password"));
		await expect(useSecretsStore.getState().unlock("nope")).rejects.toThrow(
			"incorrect password",
		);
	});

	it("lock calls the api and refreshes status", async () => {
		lockApi.mockResolvedValue(undefined);
		statusApi.mockResolvedValue({ encrypted: true, unlocked: false });

		await useSecretsStore.getState().lock();

		expect(lockApi).toHaveBeenCalled();
		expect(useSecretsStore.getState().unlocked).toBe(false);
	});

	it("resetPassword forwards old + new passwords", async () => {
		resetApi.mockResolvedValue(undefined);
		statusApi.mockResolvedValue({ encrypted: true, unlocked: true });

		await useSecretsStore.getState().resetPassword("old", "new");

		expect(resetApi).toHaveBeenCalledWith("old", "new");
	});
});
