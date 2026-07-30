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
	default: ({
		profile,
		onStatusChange,
	}: {
		profile: ProviderProfile;
		onStatusChange: (providerId: string, status: "timeout" | "error") => void;
	}) => (
		<div>
			<div aria-label="Selected provider detail">{profile.id}</div>
			<button
				type="button"
				onClick={() => onStatusChange(profile.id, "timeout")}
			>
				Report timeout
			</button>
			<button type="button" onClick={() => onStatusChange(profile.id, "error")}>
				Report fault
			</button>
		</div>
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

	it("supports compact navigation between the provider list and detail", () => {
		render(<ProvidersPanel />);

		const detailPane = document.querySelector(
			'[data-mobile-pane="provider-detail"]',
		);
		expect(detailPane?.className).toContain("max-[700px]:hidden");

		fireEvent.click(screen.getByRole("button", { name: /Beta/ }));
		expect(detailPane?.className).not.toContain("max-[700px]:hidden");

		fireEvent.click(
			screen.getByRole("button", { name: "Back to provider list" }),
		);
		expect(detailPane?.className).toContain("max-[700px]:hidden");
	});

	it("updates the selected provider indicator from live connection status", () => {
		render(<ProvidersPanel />);

		expect(screen.getByLabelText("Alpha status: Normal").className).toContain(
			"bg-success",
		);
		fireEvent.click(screen.getByRole("button", { name: "Report timeout" }));
		expect(
			screen.getByLabelText("Alpha status: Connection timed out").className,
		).toContain("bg-warning");

		fireEvent.click(screen.getByRole("button", { name: "Report fault" }));
		expect(
			screen.getByLabelText("Alpha status: Connection fault").className,
		).toContain("bg-danger");
	});

	it("renders disabled providers without a status color", () => {
		providerState.profiles = [profiles[0], { ...profiles[1], enabled: false }];
		render(<ProvidersPanel />);

		const indicator = screen.getByLabelText("Beta status: Disabled");
		expect(indicator.className).toContain("bg-transparent");
		expect(indicator.className).not.toMatch(/bg-(success|warning|danger)/);
	});
});
