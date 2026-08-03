import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "../../stores/settingsStore";

const logs = vi.fn();
const setFullCommunicationLogs = vi.fn();

vi.mock("../../services/devtools", () => ({
	inTauri: () => true,
	devtools: {
		logs: (after: number) => logs(after),
		setFullCommunicationLogs: (enabled: boolean) =>
			setFullCommunicationLogs(enabled),
	},
}));

vi.mock("../../stores/confirmStore", () => ({
	confirm: { ask: vi.fn().mockResolvedValue(true) },
}));

import ProviderDebugPanel from "./ProviderDebugPanel";
import { providerDebugInternals } from "./ProviderDebugPanel";

describe("ProviderDebugPanel", () => {
	beforeEach(() => {
		logs.mockReset().mockResolvedValue([
			{
				seq: 1,
				source: "gateway",
				level: "info",
				message:
					"channel=communication provider=alpha url=https://alpha.example/v1/chat",
			},
			{
				seq: 2,
				source: "gateway",
				level: "info",
				message:
					"channel=communication provider=beta url=https://beta.example/v1/chat",
			},
			{
				seq: 3,
				source: "gateway",
				level: "error",
				message: "alpha provider failed without a communication trace",
			},
		]);
		setFullCommunicationLogs.mockReset().mockResolvedValue(true);
		useSettingsStore.setState({
			devMode: true,
			fullCommunicationLogs: false,
		});
	});

	afterEach(cleanup);

	it("shows only communication entries matching the selected provider", async () => {
		render(
			<ProviderDebugPanel
				target={{
					id: "alpha",
					name: "Alpha",
					matchers: ["https://alpha.example/v1"],
				}}
				onClose={vi.fn()}
			/>,
		);

		await waitFor(() =>
			expect(screen.getByText(/provider=alpha/)).toBeDefined(),
		);
		expect(screen.queryByText(/provider=beta/)).toBeNull();
		expect(screen.queryByText(/failed without/)).toBeNull();
		expect(logs).toHaveBeenCalledWith(0);
	});

	it("matches short provider IDs only at structured provider boundaries", () => {
		const matchers = providerDebugInternals.normalizedMatchers({
			id: "ps",
			name: "ps",
			matchers: ["https://slb-v1.api.fan/anthropic/v1"],
		});

		expect(matchers).toContain("/providers/ps/");
		expect(matchers).toContain('"provider":"ps"');
		expect(matchers).not.toContain("ps");
	});
});
