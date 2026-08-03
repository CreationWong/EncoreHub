import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { useCallback, useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderProfile } from "../../services/providers";

const loadKeys = vi.fn();
const refreshSecrets = vi.fn();
let devMode = false;
const draftMocks = vi.hoisted(() => ({
	chooseUnsavedAction: vi.fn(),
	saveProviderDraft: vi.fn(),
	discardProviderDraft: vi.fn(),
}));
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
			devMode: boolean;
			fullCommunicationLogs: boolean;
			setApiKey: ReturnType<typeof vi.fn>;
			clearApiKey: ReturnType<typeof vi.fn>;
			loadKeys: typeof loadKeys;
			setFullCommunicationLogs: ReturnType<typeof vi.fn>;
		}) => unknown,
	) =>
		selector({
			apiKeys: {},
			devMode,
			fullCommunicationLogs: false,
			setApiKey: vi.fn(),
			clearApiKey: vi.fn(),
			loadKeys,
			setFullCommunicationLogs: vi.fn(),
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
	confirm: { ask: vi.fn(), choose: draftMocks.chooseUnsavedAction },
}));

vi.mock("../../stores/toastStore", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("./ProviderDetail", () => ({
	default: ({
		profile,
		onStatusChange,
		onDraftControllerChange,
		onOpenDebug,
	}: {
		profile: ProviderProfile;
		onStatusChange: (providerId: string, status: "timeout" | "error") => void;
		onDraftControllerChange?: (
			providerId: string,
			controller: {
				dirty: boolean;
				save: () => Promise<boolean>;
				discard: () => void;
			} | null,
		) => void;
		onOpenDebug?: (matchers: string[]) => void;
	}) => {
		const [draftValue, setDraftValue] = useState("");
		const save = useCallback(async () => {
			draftMocks.saveProviderDraft(profile.id, draftValue);
			return true;
		}, [draftValue, profile.id]);
		const discard = useCallback(() => {
			draftMocks.discardProviderDraft(profile.id);
			setDraftValue("");
		}, [profile.id]);
		useEffect(() => {
			onDraftControllerChange?.(profile.id, {
				dirty: Boolean(draftValue),
				save,
				discard,
			});
		}, [discard, draftValue, onDraftControllerChange, profile.id, save]);
		return (
			<div aria-label={`Provider detail ${profile.id}`}>
				<div aria-label="Selected provider detail">{profile.id}</div>
				<input
					aria-label={`Draft value ${profile.id}`}
					value={draftValue}
					onChange={(event) => setDraftValue(event.target.value)}
				/>
				<button
					type="button"
					onClick={() => onStatusChange(profile.id, "timeout")}
				>
					Report timeout
				</button>
				<button
					type="button"
					onClick={() => onStatusChange(profile.id, "error")}
				>
					Report fault
				</button>
				{onOpenDebug && (
					<button
						type="button"
						onClick={() => onOpenDebug([profile.base_url, ...profile.models])}
					>
						Debug {profile.name}
					</button>
				)}
			</div>
		);
	},
}));

vi.mock("./ProviderFormModal", () => ({
	default: () => null,
}));

import ProvidersPanel from "./ProvidersPanel";
import { runAfterSettingsLeaveGuard } from "./settingsLeaveGuard";

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
	draftMocks.chooseUnsavedAction.mockResolvedValue("cancel");
	devMode = false;
});

afterEach(cleanup);

describe("ProvidersPanel selection preference", () => {
	const selectedDetail = () =>
		document.querySelector(
			'[data-provider-detail]:not([hidden]) [aria-label="Selected provider detail"]',
		);

	it("restores the last selected provider", () => {
		localStorage.setItem("encorehub-settings-provider", "beta");

		render(<ProvidersPanel />);

		expect(
			screen.getByRole("button", { name: /Beta/ }).getAttribute("aria-current"),
		).toBe("page");
		expect(selectedDetail()?.textContent).toBe("beta");
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
		expect(selectedDetail()?.textContent).toBe("beta");
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

	it("keeps each provider draft in memory while switching providers", () => {
		render(<ProvidersPanel />);

		fireEvent.change(screen.getByLabelText("Draft value alpha"), {
			target: { value: "unfinished endpoint" },
		});
		fireEvent.click(screen.getByRole("button", { name: /Beta/ }));
		fireEvent.click(screen.getByRole("button", { name: /Alpha/ }));

		expect(screen.getByLabelText("Draft value alpha")).toHaveProperty(
			"value",
			"unfinished endpoint",
		);
	});

	it("prompts before leaving and keeps drafts when the user cancels", async () => {
		render(<ProvidersPanel />);
		fireEvent.change(screen.getByLabelText("Draft value alpha"), {
			target: { value: "unfinished endpoint" },
		});
		const leave = vi.fn();

		runAfterSettingsLeaveGuard(leave);

		await waitFor(() =>
			expect(draftMocks.chooseUnsavedAction).toHaveBeenCalledTimes(1),
		);
		expect(leave).not.toHaveBeenCalled();
		expect(screen.getByLabelText("Draft value alpha")).toHaveProperty(
			"value",
			"unfinished endpoint",
		);
	});

	it("supports leaving without saving and clears every in-memory draft", async () => {
		draftMocks.chooseUnsavedAction.mockResolvedValue("discard");
		render(<ProvidersPanel />);
		fireEvent.change(screen.getByLabelText("Draft value alpha"), {
			target: { value: "unfinished endpoint" },
		});
		const leave = vi.fn();

		runAfterSettingsLeaveGuard(leave);

		await waitFor(() => expect(leave).toHaveBeenCalledTimes(1));
		expect(draftMocks.discardProviderDraft).toHaveBeenCalledWith("alpha");
		expect(screen.getByLabelText("Draft value alpha")).toHaveProperty(
			"value",
			"",
		);
	});

	it("saves every dirty draft before leaving", async () => {
		draftMocks.chooseUnsavedAction.mockResolvedValue("confirm");
		render(<ProvidersPanel />);
		fireEvent.change(screen.getByLabelText("Draft value alpha"), {
			target: { value: "alpha endpoint" },
		});
		fireEvent.change(screen.getByLabelText("Draft value beta"), {
			target: { value: "beta endpoint" },
		});
		const leave = vi.fn();

		runAfterSettingsLeaveGuard(leave);

		await waitFor(() => expect(leave).toHaveBeenCalledTimes(1));
		expect(draftMocks.saveProviderDraft).toHaveBeenCalledWith(
			"alpha",
			"alpha endpoint",
		);
		expect(draftMocks.saveProviderDraft).toHaveBeenCalledWith(
			"beta",
			"beta endpoint",
		);
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

	it("shows provider debugging only in developer mode", () => {
		const standardView = render(<ProvidersPanel />);
		expect(screen.queryByRole("button", { name: "Debug Alpha" })).toBeNull();
		standardView.unmount();

		devMode = true;
		render(<ProvidersPanel />);
		fireEvent.click(screen.getByRole("button", { name: "Debug Alpha" }));

		expect(
			screen.getByRole("complementary", { name: "Debug Alpha" }),
		).toBeDefined();
		fireEvent.click(
			screen.getByRole("button", { name: "Close provider debug panel" }),
		);
		expect(
			screen.queryByRole("complementary", { name: "Debug Alpha" }),
		).toBeNull();
	});
});
