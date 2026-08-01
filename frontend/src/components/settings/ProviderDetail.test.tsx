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
import { useModelMetadataStore } from "../../stores/modelMetadataStore";
import { parseProviderAPIKeys, serializeProviderAPIKeys } from "./providerKeys";

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
		onStatusChange: vi.fn(),
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
	useModelMetadataStore.setState({
		loaded: true,
		loading: false,
		error: null,
		recordsByProvider: {},
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
		const { props } = renderDetail();
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
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "Apply & save" }));
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(screen.getByText("Discovered Model")).toBeDefined();
		expect(props.onSave).not.toHaveBeenCalled();
		expect(
			screen.getByRole("button", { name: "Create provider" }),
		).toHaveProperty("disabled", false);
	});

	it("stages selected discovered models locally for a provider draft", async () => {
		vi.useRealTimers();
		discoverModels.mockResolvedValueOnce({
			provider: "custom",
			discovery_supported: true,
			success_count: 1,
			models: Array.from({ length: 10 }, (_, index) => ({
				id: `remote-model-${index + 1}`,
				name: `Remote Model ${index + 1}`,
				provider: "custom",
				owned_by: "remote",
			})),
			endpoint_results: [
				{ endpoint_id: "primary", status: "ok", model_count: 10 },
			],
		});
		const onSave = vi
			.fn()
			.mockRejectedValue(new Error("draft cannot persist yet"));
		renderDetail({ onSave });
		fireEvent.click(screen.getByRole("button", { name: "Add API key" }));
		fireEvent.change(screen.getByLabelText("API key 1 value"), {
			target: { value: "session-key" },
		});
		fireEvent.change(screen.getByLabelText("Endpoint 1 URL"), {
			target: { value: "https://api.example.com/v1" },
		});

		fireEvent.click(screen.getByRole("button", { name: "Fetch model list" }));
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Save selected models" }),
			).toBeDefined(),
		);
		fireEvent.click(screen.getByRole("button", { name: "Clear" }));
		fireEvent.click(screen.getAllByRole("checkbox")[0]);
		fireEvent.click(
			screen.getByRole("button", { name: "Save selected models" }),
		);

		await waitFor(() =>
			expect(screen.getByText("Remote Model 1")).toBeDefined(),
		);
		expect(onSave).not.toHaveBeenCalled();
		expect(
			screen.getByRole("button", { name: "Create provider" }),
		).toHaveProperty("disabled", false);
	});

	it("draws API key focus around the complete value control", () => {
		renderDetail();
		fireEvent.click(screen.getByRole("button", { name: "Add API key" }));

		const valueInput = screen.getByLabelText("API key 1 value");

		expect(valueInput.parentElement?.className).toContain(
			"provider-key-value-control",
		);
	});

	it("automatically checks completed connection input and reports normal health", async () => {
		const onStatusChange = vi.fn();
		renderDetail({
			profile: { ...profile, enabled: true },
			isDraft: false,
			onStatusChange,
		});
		fireEvent.click(screen.getByRole("button", { name: "Add API key" }));
		fireEvent.change(screen.getByLabelText("API key 1 value"), {
			target: { value: "session-key" },
		});
		fireEvent.change(screen.getByLabelText("Endpoint 1 URL"), {
			target: { value: "https://api.example.com/v1" },
		});

		expect(onStatusChange).toHaveBeenLastCalledWith("custom", "waiting");
		await act(async () => {
			vi.advanceTimersByTime(900);
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(validateKey).toHaveBeenCalledTimes(1);
		expect(onStatusChange).toHaveBeenLastCalledWith("custom", "healthy");
	});

	it("initializes saved enabled key and endpoint indicators after every mount", () => {
		const configured: ProviderProfile = {
			...profile,
			enabled: true,
			base_url: "https://api.example.com/v1",
			endpoints: [
				{
					id: "primary",
					name: "Primary endpoint",
					base_url: "https://api.example.com/v1",
					enabled: true,
				},
			],
		};
		const savedKeys = serializeProviderAPIKeys([
			{ id: "primary", name: "Primary", value: "saved-key", enabled: true },
		]);
		const renderConfigured = () =>
			renderDetail({
				profile: configured,
				isDraft: false,
				apiKey: savedKeys,
				keyStored: true,
			});

		const firstMount = renderConfigured();
		expect(screen.getByLabelText("Primary: Normal").className).toContain(
			"bg-success",
		);
		expect(
			screen.getByLabelText("Primary endpoint: Normal").className,
		).toContain("bg-success");

		firstMount.unmount();
		renderConfigured();
		expect(screen.getByLabelText("Primary: Normal")).toBeDefined();
		expect(screen.getByLabelText("Primary endpoint: Normal")).toBeDefined();
	});

	it("uses disabled and waiting indicator states when a row switch changes", () => {
		const savedKeys = serializeProviderAPIKeys([
			{ id: "primary", name: "Primary", value: "saved-key", enabled: true },
		]);
		renderDetail({
			profile: {
				...profile,
				enabled: true,
				base_url: "https://api.example.com/v1",
				endpoints: [
					{
						id: "primary",
						name: "Primary endpoint",
						base_url: "https://api.example.com/v1",
						enabled: true,
					},
				],
			},
			isDraft: false,
			apiKey: savedKeys,
			keyStored: true,
		});

		fireEvent.click(screen.getByRole("switch", { name: "Disable API key 1" }));
		expect(screen.getByLabelText("Primary: Disabled").className).toContain(
			"bg-transparent",
		);

		fireEvent.click(screen.getByRole("switch", { name: "Enable API key 1" }));
		expect(
			screen.getByLabelText("Primary: Waiting for connection check").className,
		).toContain("bg-warning");
	});

	it("reports connection timeouts as warning status", async () => {
		validateKey.mockResolvedValueOnce({
			provider: "custom",
			valid: false,
			success_count: 0,
			key_results: [
				{
					key_id: "key-test-1",
					status: "error",
					endpoint_id: "primary",
					error_category: "timeout",
				},
			],
			endpoint_results: [
				{
					endpoint_id: "primary",
					status: "unreachable",
					latency_ms: 20000,
					error_category: "timeout",
				},
			],
		});
		const onStatusChange = vi.fn();
		renderDetail({
			profile: { ...profile, enabled: true },
			isDraft: false,
			onStatusChange,
		});
		fireEvent.click(screen.getByRole("button", { name: "Add API key" }));
		fireEvent.change(screen.getByLabelText("API key 1 value"), {
			target: { value: "session-key" },
		});
		fireEvent.change(screen.getByLabelText("Endpoint 1 URL"), {
			target: { value: "https://slow.example.com/v1" },
		});

		await act(async () => {
			vi.advanceTimersByTime(900);
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(onStatusChange).toHaveBeenLastCalledWith("custom", "timeout");
	});

	it("discard restores unsaved fields, switch, and disabled status", () => {
		const onStatusChange = vi.fn();
		renderDetail({ isDraft: false, onStatusChange });

		fireEvent.change(screen.getByLabelText("Endpoint 1 URL"), {
			target: { value: "https://draft.example.com/v1" },
		});
		fireEvent.click(screen.getByRole("switch", { name: "Enable provider" }));
		expect(onStatusChange).toHaveBeenLastCalledWith("custom", "waiting");

		fireEvent.click(screen.getByRole("button", { name: "Discard" }));

		expect(screen.getByLabelText("Endpoint 1 URL")).toHaveProperty("value", "");
		expect(
			screen
				.getByRole("switch", { name: "Enable provider" })
				.getAttribute("aria-checked"),
		).toBe("false");
		expect(onStatusChange).toHaveBeenLastCalledWith("custom", "disabled");
	});

	it("discard cancels the pending automatic connection actions", async () => {
		const configured: ProviderProfile = {
			...profile,
			enabled: true,
			base_url: "https://saved.example.com/v1",
			endpoints: [
				{
					id: "primary",
					name: "Primary",
					base_url: "https://saved.example.com/v1",
					enabled: true,
				},
			],
		};
		renderDetail({
			profile: configured,
			isDraft: false,
			apiKey: "saved-key",
			keyStored: true,
		});

		fireEvent.change(screen.getByLabelText("Endpoint 1 URL"), {
			target: { value: "https://draft.example.com/v1" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Discard" }));
		await act(async () => {
			vi.advanceTimersByTime(900);
			await Promise.resolve();
		});

		expect(validateKey).not.toHaveBeenCalled();
		expect(discoverModels).not.toHaveBeenCalled();
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
		const { props, rerender } = renderDetail({
			onSave,
			onSetKey,
			isDraft: false,
		});
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
		expect(screen.getByText(/2 models mapped and saved/)).toBeDefined();
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
