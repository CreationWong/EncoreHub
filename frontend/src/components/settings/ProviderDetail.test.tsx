import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderProfile } from "../../services/providers";
import { parseProviderAPIKeys } from "./providerKeys";

const discoverModels = vi.fn();
const validateKey = vi.fn();
vi.mock("../../services/providers", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("../../services/providers")>();
	return {
		...original,
		providersApi: {
			...original.providersApi,
			discoverModels: (...args: unknown[]) => discoverModels(...args),
			validateKey: (...args: unknown[]) => validateKey(...args),
		},
	};
});

const unlock = vi.fn();
vi.mock("../../stores/secretsStore", () => ({
	useSecretsStore: (selector: (state: { unlock: typeof unlock }) => unknown) =>
		selector({ unlock }),
}));

const loadKeys = vi.fn();
vi.mock("../../stores/settingsStore", () => ({
	useSettingsStore: (
		selector: (state: { loadKeys: typeof loadKeys }) => unknown,
	) => selector({ loadKeys }),
}));

vi.mock("../../stores/toastStore", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

import ProviderDetail from "./ProviderDetail";

const profile: ProviderProfile = {
	id: "custom",
	name: "Custom Provider",
	protocol: "openai",
	base_url: "",
	models: ["existing-model"],
	model_configs: [
		{
			id: "existing-model",
			name: "Existing Model",
			group: "General",
			capabilities: ["tools"],
			streaming: true,
			currency: "USD",
			input_price: 0,
			output_price: 0,
		},
	],
	enabled: false,
	builtin: false,
};

function renderDetail(
	overrides: Partial<Parameters<typeof ProviderDetail>[0]> = {},
) {
	const props: Parameters<typeof ProviderDetail>[0] = {
		profile,
		isDraft: true,
		apiKey: "",
		vaultLocked: false,
		keyStored: false,
		onSetKey: vi.fn(),
		onClearKey: vi.fn().mockResolvedValue(undefined),
		onSave: vi.fn().mockResolvedValue(undefined),
		onDelete: vi.fn(),
		...overrides,
	};
	const view = render(<ProviderDetail {...props} />);
	return { props, ...view };
}

beforeEach(() => {
	vi.useFakeTimers();
	validateKey.mockReset().mockResolvedValue({
		provider: "custom",
		valid: true,
		success_count: 1,
		key_results: [
			{
				key_id: "key-test-1",
				status: "valid",
				endpoint_id: "primary",
			},
		],
		endpoint_results: [
			{ endpoint_id: "primary", status: "valid", latency_ms: 5 },
		],
	});
	discoverModels.mockReset().mockResolvedValue({
		provider: "custom",
		discovery_supported: true,
		success_count: 1,
		models: [
			{ id: "existing-model", name: "Existing Model", provider: "custom" },
			{ id: "discovered-model", name: "Discovered Model", provider: "custom" },
		],
		endpoint_results: [
			{ endpoint_id: "primary", status: "ok", model_count: 2 },
		],
	});
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe("ProviderDetail", () => {
	it("explains the same-provider endpoint restriction and supports both routing modes", () => {
		renderDetail();
		expect(
			screen.getByText(/Only different endpoints for the same provider/),
		).toBeDefined();
		const endpointRouting = screen.getByRole("group", {
			name: "Endpoint routing strategy",
		});
		expect(
			within(endpointRouting).getByRole("button", { name: "Failover" }),
		).toBeDefined();
		expect(
			within(endpointRouting).getByRole("button", { name: "Round-robin" }),
		).toBeDefined();
		expect(
			screen.getByRole("group", { name: "API key routing strategy" }),
		).toBeDefined();
	});

	it("automatically fetches models but waits for diff confirmation", async () => {
		renderDetail();
		fireEvent.click(screen.getByRole("button", { name: "Add API key" }));
		fireEvent.change(screen.getByLabelText("API key 1 value"), {
			target: { value: "session-key" },
		});
		fireEvent.change(screen.getByLabelText("Endpoint 1 URL"), {
			target: { value: "https://api.example.com/v1" },
		});

		await act(async () => {
			vi.advanceTimersByTime(900);
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(discoverModels).toHaveBeenCalledTimes(1);
		expect(discoverModels).toHaveBeenCalledWith(
			"custom",
			"openai",
			expect.arrayContaining([
				expect.objectContaining({
					base_url: "https://api.example.com/v1",
				}),
			]),
			expect.stringContaining('"value":"session-key"'),
			"failover",
		);
		expect(
			screen.getByRole("region", { name: "Model discovery changes" }),
		).toBeDefined();
		expect(screen.queryByText("Discovered Model")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Apply to draft" }));
		expect(screen.getByText("Discovered Model")).toBeDefined();
	});

	it("tests temporary keys without persisting and keeps other commands available", async () => {
		let resolveValidation: ((value: unknown) => void) | undefined;
		validateKey.mockReturnValue(
			new Promise((resolve) => {
				resolveValidation = resolve;
			}),
		);
		const onSetKey = vi.fn();
		const onSave = vi.fn().mockResolvedValue(undefined);
		renderDetail({ onSetKey, onSave });
		fireEvent.click(screen.getByRole("button", { name: "Add API key" }));
		fireEvent.change(screen.getByLabelText("API key 1 value"), {
			target: { value: "temporary-session-key" },
		});
		fireEvent.change(screen.getByLabelText("Endpoint 1 URL"), {
			target: { value: "https://api.example.com/v1" },
		});

		fireEvent.click(
			screen.getByRole("button", { name: "Test API keys and endpoints" }),
		);
		expect(
			screen.getByRole("button", { name: "Test API keys and endpoints" }),
		).toHaveProperty("disabled", true);
		expect(
			screen.getByRole("button", { name: "Fetch model list" }),
		).toHaveProperty("disabled", false);
		expect(screen.getByLabelText("API key 1 value")).toHaveProperty(
			"disabled",
			false,
		);
		const testedKeyID = parseProviderAPIKeys(
			validateKey.mock.calls[0][3] as string,
		)[0].id;

		await act(async () => {
			resolveValidation?.({
				provider: "custom",
				valid: true,
				success_count: 1,
				key_results: [
					{
						key_id: testedKeyID,
						status: "valid",
						endpoint_id: "primary",
					},
				],
				endpoint_results: [
					{ endpoint_id: "primary", status: "valid", latency_ms: 5 },
				],
			});
			await Promise.resolve();
		});

		expect(validateKey).toHaveBeenCalledWith(
			"custom",
			"openai",
			expect.arrayContaining([
				expect.objectContaining({
					base_url: "https://api.example.com/v1",
				}),
			]),
			expect.stringContaining('"value":"temporary-session-key"'),
		);
		expect(screen.getByText(/1 of 1 keys valid/)).toBeDefined();
		expect(screen.getByLabelText("Primary: Key is valid")).toBeDefined();
		expect(onSetKey).not.toHaveBeenCalled();
		expect(onSave).not.toHaveBeenCalled();
	});

	it("keeps validation disabled while the encrypted key pool is locked", () => {
		renderDetail({ vaultLocked: true, keyStored: true, apiKey: "" });
		expect(
			screen.getByRole("button", { name: "Test API keys and endpoints" }),
		).toHaveProperty("disabled", true);
	});

	it("waits for every API key row before automatic discovery", async () => {
		renderDetail();
		fireEvent.click(screen.getByRole("button", { name: "Add API key" }));
		fireEvent.change(screen.getByLabelText("API key 1 value"), {
			target: { value: "primary-key" },
		});
		fireEvent.change(screen.getByLabelText("Endpoint 1 URL"), {
			target: { value: "https://api.example.com/v1" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Add API key" }));

		await act(async () => {
			vi.advanceTimersByTime(900);
			await Promise.resolve();
		});
		expect(discoverModels).not.toHaveBeenCalled();

		fireEvent.change(screen.getByLabelText("API key 2 value"), {
			target: { value: "backup-key" },
		});
		await act(async () => {
			vi.advanceTimersByTime(900);
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(discoverModels).toHaveBeenCalledTimes(1);
	});

	it("saves only the model list after a manual model fetch", async () => {
		vi.useRealTimers();
		const onSave = vi.fn().mockResolvedValue(undefined);
		const onSetKey = vi.fn();
		const { props, rerender } = renderDetail({ onSave, onSetKey });
		fireEvent.click(screen.getByRole("button", { name: "Add API key" }));
		fireEvent.change(screen.getByLabelText("API key 1 value"), {
			target: { value: "session-key" },
		});
		fireEvent.change(screen.getByLabelText("Endpoint 1 URL"), {
			target: { value: "https://api.example.com/v1" },
		});

		fireEvent.click(screen.getByRole("button", { name: "Fetch model list" }));

		await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
		const saved = onSave.mock.calls[0][0] as ProviderProfile;
		expect(saved.base_url).toBe(profile.base_url);
		expect(saved.endpoints).toBe(profile.endpoints);
		expect(saved.routing_strategy).toBe(profile.routing_strategy);
		expect(saved.key_routing_strategy).toBe(profile.key_routing_strategy);
		expect(saved.models).toEqual(["existing-model", "discovered-model"]);
		expect(saved.model_configs).toEqual([
			expect.objectContaining({ id: "existing-model" }),
			expect.objectContaining({ id: "discovered-model" }),
		]);
		expect(onSetKey).not.toHaveBeenCalled();

		rerender(<ProviderDetail {...props} profile={saved} isDraft={false} />);
		expect(screen.getByLabelText("Endpoint 1 URL")).toHaveProperty(
			"value",
			"https://api.example.com/v1",
		);
		expect(screen.getByLabelText("API key 1 value")).toHaveProperty(
			"value",
			"session-key",
		);
		expect(screen.getByText("Unsaved changes")).toBeDefined();
		expect(
			screen.queryByRole("region", { name: "Model discovery changes" }),
		).toBeNull();
		expect(screen.getByText(/2 models fetched and saved/)).toBeDefined();
	});

	it("persists endpoint routing, model metadata, and key only on save", async () => {
		vi.useRealTimers();
		const onSave = vi.fn().mockResolvedValue(undefined);
		const onSetKey = vi.fn();
		const configured: ProviderProfile = {
			...profile,
			base_url: "https://primary.example.com/v1",
			endpoints: [
				{
					id: "primary",
					name: "Primary",
					base_url: "https://primary.example.com/v1",
					enabled: true,
				},
			],
		};
		renderDetail({ profile: configured, isDraft: false, onSave, onSetKey });

		fireEvent.click(screen.getByRole("button", { name: "Add endpoint" }));
		fireEvent.change(screen.getByLabelText("Endpoint 2 URL"), {
			target: { value: "https://backup.example.com/v1" },
		});
		const endpointRouting = screen.getByRole("group", {
			name: "Endpoint routing strategy",
		});
		fireEvent.click(
			within(endpointRouting).getByRole("button", { name: "Round-robin" }),
		);
		fireEvent.click(screen.getByRole("button", { name: "Add API key" }));
		fireEvent.change(screen.getByLabelText("API key 1 value"), {
			target: { value: "updated-key" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Add API key" }));
		fireEvent.change(screen.getByLabelText("API key 2 value"), {
			target: { value: "backup-key" },
		});
		const keyRouting = screen.getByRole("group", {
			name: "API key routing strategy",
		});
		fireEvent.click(
			within(keyRouting).getByRole("button", { name: "Round-robin" }),
		);

		expect(onSetKey).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
		expect(onSave).toHaveBeenCalledWith(
			expect.objectContaining({
				routing_strategy: "round_robin",
				key_routing_strategy: "round_robin",
				endpoints: expect.arrayContaining([
					expect.objectContaining({
						base_url: "https://backup.example.com/v1",
					}),
				]),
				model_configs: expect.arrayContaining([
					expect.objectContaining({
						id: "existing-model",
						capabilities: ["tools"],
					}),
				]),
			}),
		);
		expect(onSetKey).toHaveBeenCalledTimes(1);
		expect(parseProviderAPIKeys(onSetKey.mock.calls[0][0])).toEqual([
			expect.objectContaining({ value: "updated-key", enabled: true }),
			expect.objectContaining({ value: "backup-key", enabled: true }),
		]);
	});

	it("replaces the original model when its request ID is edited", async () => {
		vi.useRealTimers();
		const onSave = vi.fn().mockResolvedValue(undefined);
		const configured: ProviderProfile = {
			...profile,
			base_url: "https://api.example.com/v1",
			endpoints: [
				{
					id: "primary",
					name: "Primary",
					base_url: "https://api.example.com/v1",
					enabled: true,
				},
			],
		};
		renderDetail({ profile: configured, isDraft: false, onSave });

		fireEvent.click(
			screen.getByRole("button", {
				name: "Existing Model existing-model",
			}),
		);
		fireEvent.change(screen.getByPlaceholderText("gpt-4.1-mini"), {
			target: { value: "request-model-new" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
		const saved = onSave.mock.calls[0][0] as ProviderProfile;
		expect(saved.models).toEqual(["request-model-new"]);
		expect(saved.model_configs).toEqual([
			expect.objectContaining({
				id: "request-model-new",
				name: "Existing Model",
			}),
		]);
	});
});
