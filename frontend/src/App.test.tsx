import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const loadList = vi.fn();
const loadProviders = vi.fn();
const refreshSecrets = vi.fn();
const loadKeys = vi.fn();
const loadWebSearchSettings = vi.fn();
const openSettings = vi.fn();
const setFullCommunicationLogs = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
	invoke: (...args: unknown[]) => invoke(...args),
}));

vi.mock("./components/layout/GlobalNav", () => ({ default: () => null }));
vi.mock("./components/settings/UnlockGate", () => ({ default: () => null }));
vi.mock("./components/ui/ConfirmDialog", () => ({ default: () => null }));
vi.mock("./components/ui/ToastHost", () => ({ default: () => null }));
vi.mock("./components/workspace/WorkspaceSurface", () => ({
	default: () => null,
}));

vi.mock("./stores/conversationStore", () => ({
	useConversationStore: (
		selector: (state: { loadList: typeof loadList }) => unknown,
	) => selector({ loadList }),
}));

vi.mock("./stores/providerStore", () => ({
	useProviderStore: (
		selector: (state: { load: typeof loadProviders }) => unknown,
	) => selector({ load: loadProviders }),
}));

vi.mock("./stores/secretsStore", () => ({
	useSecretsStore: (
		selector: (state: { refresh: typeof refreshSecrets }) => unknown,
	) => selector({ refresh: refreshSecrets }),
}));

vi.mock("./stores/settingsStore", () => ({
	useSettingsStore: (
		selector: (state: {
			loadKeys: typeof loadKeys;
			loadWebSearchSettings: typeof loadWebSearchSettings;
			openSettings: typeof openSettings;
			devMode: boolean;
			fullCommunicationLogs: boolean;
			setFullCommunicationLogs: typeof setFullCommunicationLogs;
		}) => unknown,
	) =>
		selector({
			loadKeys,
			loadWebSearchSettings,
			openSettings,
			devMode: true,
			fullCommunicationLogs: false,
			setFullCommunicationLogs,
		}),
}));

import App from "./App";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

describe("App startup", () => {
	beforeEach(() => {
		(
			window as unknown as { __TAURI_INTERNALS__?: object }
		).__TAURI_INTERNALS__ = {};
		invoke.mockReset();
		loadList.mockReset();
		loadProviders.mockReset();
		refreshSecrets.mockReset();
		loadKeys.mockReset();
		loadWebSearchSettings.mockReset();
		openSettings.mockReset();
		setFullCommunicationLogs.mockReset();
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ engine: { ok: true } }),
			}),
		);
	});

	afterEach(() => {
		(
			window as unknown as { __TAURI_INTERNALS__?: object }
		).__TAURI_INTERNALS__ = undefined;
		vi.unstubAllGlobals();
		cleanup();
	});

	it("waits for Tauri ports before polling gateway health", async () => {
		const ports = deferred<{ gateway_port: number }>();
		invoke.mockReturnValue(ports.promise);

		render(<App />);
		await waitFor(() =>
			expect(invoke).toHaveBeenCalledWith("get_service_ports"),
		);
		expect(fetch).not.toHaveBeenCalled();

		ports.resolve({ gateway_port: 10001 });

		await waitFor(() =>
			expect(fetch).toHaveBeenCalledWith(
				"http://127.0.0.1:10001/api/v1/health/ready",
			),
		);
		await waitFor(() => expect(loadWebSearchSettings).toHaveBeenCalledOnce());
	});

	it("does not load application data while Engine is not ready", async () => {
		invoke.mockResolvedValue({ gateway_port: 10001 });
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ engine: { ok: false } }),
			}),
		);

		render(<App />);
		await waitFor(() => expect(fetch).toHaveBeenCalled());
		expect(loadList).not.toHaveBeenCalled();
		expect(loadProviders).not.toHaveBeenCalled();
		expect(loadWebSearchSettings).not.toHaveBeenCalled();
	});

	it("synchronizes developer access and communication logging independently", async () => {
		invoke.mockImplementation(async (command: string) => {
			if (command === "get_service_ports") return { gateway_port: 10001 };
			if (command === "set_developer_mode") return true;
			if (command === "set_full_communication_logs") return false;
			return undefined;
		});

		render(<App />);

		await waitFor(() =>
			expect(invoke).toHaveBeenCalledWith("set_developer_mode", {
				enabled: true,
			}),
		);
		expect(invoke).toHaveBeenCalledWith("set_full_communication_logs", {
			enabled: false,
		});
	});
});
