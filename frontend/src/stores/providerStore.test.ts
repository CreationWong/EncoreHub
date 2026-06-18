import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderProfile } from "../services/providers";

// providersApi is mocked so the store never touches the network.
const listApi = vi.fn();
const updateApi = vi.fn();
vi.mock("../services/providers", () => ({
	providersApi: {
		list: (...args: unknown[]) => listApi(...args),
		update: (...args: unknown[]) => updateApi(...args),
	},
}));

import { useProviderStore } from "./providerStore";

function profile(over: Partial<ProviderProfile> = {}): ProviderProfile {
	return {
		id: "custom",
		name: "Custom",
		protocol: "openai",
		base_url: "https://api.example.com/v1",
		models: ["m1"],
		enabled: true,
		builtin: false,
		...over,
	};
}

describe("providerStore", () => {
	beforeEach(() => {
		listApi.mockReset();
		updateApi.mockReset();
		useProviderStore.setState({
			profiles: [],
			loading: false,
			loaded: false,
			error: null,
		});
	});

	it("load populates profiles and sets loaded", async () => {
		const p = profile();
		listApi.mockResolvedValue({ providers: [p] });
		await useProviderStore.getState().load();
		const s = useProviderStore.getState();
		expect(s.profiles).toEqual([p]);
		expect(s.loaded).toBe(true);
		expect(s.error).toBeNull();
	});

	it("load captures error message and stops loading", async () => {
		listApi.mockRejectedValue(new Error("offline"));
		await useProviderStore.getState().load();
		const s = useProviderStore.getState();
		expect(s.loading).toBe(false);
		expect(s.error).toBe("offline");
	});

	it("upsert adds a new profile and adopts gateway response", async () => {
		const existing = profile({ id: "openai", builtin: true });
		useProviderStore.setState({ profiles: [existing] });
		const added = profile({ id: "custom" });
		updateApi.mockResolvedValue({ providers: [existing, added] });

		await useProviderStore.getState().upsert(added);

		expect(updateApi).toHaveBeenCalledWith([existing, added]);
		expect(useProviderStore.getState().profiles).toHaveLength(2);
	});

	it("upsert replaces an existing profile by id", async () => {
		const original = profile({ id: "custom", name: "Old" });
		useProviderStore.setState({ profiles: [original] });
		const edited = profile({ id: "custom", name: "New" });
		updateApi.mockResolvedValue({ providers: [edited] });

		await useProviderStore.getState().upsert(edited);

		const sent = updateApi.mock.calls[0][0] as ProviderProfile[];
		expect(sent).toHaveLength(1);
		expect(sent[0].name).toBe("New");
	});

	it("remove drops the profile by id before persisting", async () => {
		const a = profile({ id: "a" });
		const b = profile({ id: "b" });
		useProviderStore.setState({ profiles: [a, b] });
		updateApi.mockResolvedValue({ providers: [a] });

		await useProviderStore.getState().remove("b");

		expect(updateApi).toHaveBeenCalledWith([a]);
		expect(useProviderStore.getState().profiles).toEqual([a]);
	});

	it("save propagates gateway errors to the caller", async () => {
		updateApi.mockRejectedValue(new Error("cannot delete builtin"));
		await expect(useProviderStore.getState().save([])).rejects.toThrow(
			"cannot delete builtin",
		);
	});
});
