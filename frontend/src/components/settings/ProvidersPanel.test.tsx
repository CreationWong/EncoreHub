import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderProfile } from "../../services/providers";

const loadKeys = vi.fn();
const refreshSecrets = vi.fn();
const providerState = {
	profiles: [] as ProviderProfile[],
	loading: false,
	loaded: true,
	upsert: vi.fn(),
	remove: vi.fn(),
};

vi.mock("../../stores/providerStore", () => ({
	useProviderStore: (selector: (state: typeof providerState) => unknown) =>
		selector(providerState),
}));

vi.mock("../../stores/settingsStore", () => ({
	useSettingsStore: (
		selector: (state: {
			apiKeys: Record<string, string>;
			setApiKey: ReturnType<typeof vi.fn>;
			clearApiKey: ReturnType<typeof vi.fn>;
			loadKeys: typeof loadKeys;
		}) => unknown,
	) =>
		selector({
			apiKeys: {},
			setApiKey: vi.fn(),
			clearApiKey: vi.fn(),
			loadKeys,
		}),
}));

vi.mock("../../stores/secretsStore", () => ({
	useSecretsStore: (
		selector: (state: {
			encrypted: boolean;
			unlocked: boolean;
			storedIds: string[];
			refresh: typeof refreshSecrets;
		}) => unknown,
	) =>
		selector({
			encrypted: false,
			unlocked: true,
			storedIds: [],
			refresh: refreshSecrets,
		}),
}));

vi.mock("../../stores/confirmStore", () => ({
	confirm: { ask: vi.fn() },
}));

vi.mock("../../stores/toastStore", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("./ProviderDetail", () => ({
	default: ({ profile }: { profile: ProviderProfile }) => (
		<div aria-label="Selected provider detail">{profile.id}</div>
	),
}));

vi.mock("./ProviderFormModal", () => ({
	default: () => null,
}));

import ProvidersPanel from "./ProvidersPanel";

const profiles: ProviderProfile[] = [
	{
		id: "alpha",
		name: "Alpha",
		protocol: "openai",
		base_url: "https://alpha.example/v1",
		models: ["alpha-model"],
		enabled: true,
		builtin: false,
	},
	{
		id: "beta",
		name: "Beta",
		protocol: "anthropic",
		base_url: "https://beta.example/v1",
		models: ["beta-model"],
		enabled: true,
		builtin: false,
	},
];

beforeEach(() => {
	localStorage.clear();
	providerState.profiles = profiles;
	providerState.loading = false;
	providerState.loaded = true;
	vi.clearAllMocks();
});

afterEach(cleanup);

describe("ProvidersPanel selection preference", () => {
	it("restores the last selected provider", () => {
		localStorage.setItem("encorehub-settings-provider", "beta");

		render(<ProvidersPanel />);

		expect(
			screen.getByRole("button", { name: /Beta/ }).getAttribute("aria-current"),
		).toBe("page");
		expect(screen.getByLabelText("Selected provider detail").textContent).toBe(
			"beta",
		);
	});

	it("persists selection and falls back when the saved provider is unavailable", async () => {
		localStorage.setItem("encorehub-settings-provider", "missing");
		const view = render(<ProvidersPanel />);

		await waitFor(() =>
			expect(localStorage.getItem("encorehub-settings-provider")).toBe("alpha"),
		);

		fireEvent.click(screen.getByRole("button", { name: /Beta/ }));
		expect(localStorage.getItem("encorehub-settings-provider")).toBe("beta");

		view.unmount();
		render(<ProvidersPanel />);
		expect(screen.getByLabelText("Selected provider detail").textContent).toBe(
			"beta",
		);
	});
});
