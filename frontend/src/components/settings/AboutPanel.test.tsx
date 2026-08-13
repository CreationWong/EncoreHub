import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "../../stores/settingsStore";

const getAppBuildInfo = vi.fn();
const confirmAsk = vi.fn();

vi.mock("../../services/appInfo", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../services/appInfo")>();
	return {
		...actual,
		browserBuildInfo: () => ({
			version: "V0.1.0.0",
			build_id: "260813600474",
			public_version: "V0.1.0",
			debug_build: true,
			target_os: "web",
			target_arch: "browser",
		}),
		getAppBuildInfo: (...args: unknown[]) => getAppBuildInfo(...args),
	};
});

vi.mock("../../stores/confirmStore", () => ({
	confirm: {
		ask: (...args: unknown[]) => confirmAsk(...args),
	},
}));

import AboutPanel from "./AboutPanel";

describe("AboutPanel", () => {
	beforeEach(() => {
		confirmAsk.mockReset().mockResolvedValue(true);
		getAppBuildInfo.mockReset().mockResolvedValue({
			version: "V1.2.3.4",
			build_id: "260813600474",
			public_version: "V1.2.3",
			debug_build: true,
			target_os: "windows",
			target_arch: "x86_64",
		});
		useSettingsStore.setState({
			devMode: false,
			fullCommunicationLogs: false,
		});
	});

	afterEach(cleanup);

	it("shows authoritative version, target, and debug-build information", async () => {
		render(<AboutPanel />);

		await waitFor(() =>
			expect(
				screen.getAllByText("V1.2.3.4 (Build 260813600474)").length,
			).toBeGreaterThan(0),
		);
		expect(screen.getByText("Windows / x86_64")).toBeDefined();
		expect(screen.getByText("Debug")).toBeDefined();
	});

	it("warns before enabling developer features without enabling full logging", async () => {
		render(<AboutPanel />);
		const toggle = screen.getByRole("switch", { name: "Developer tools" });
		fireEvent.click(toggle);

		await waitFor(() => expect(useSettingsStore.getState().devMode).toBe(true));
		expect(confirmAsk).toHaveBeenCalledOnce();
		expect(confirmAsk).toHaveBeenCalledWith(
			"Enable developer features?",
			expect.stringContaining("Full communication logging remains disabled"),
		);
		expect(useSettingsStore.getState().fullCommunicationLogs).toBe(false);
		expect(localStorage.getItem("encorehub-dev-mode")).toBe("1");
	});

	it("keeps developer diagnostics disabled when the warning is cancelled", async () => {
		confirmAsk.mockResolvedValue(false);
		render(<AboutPanel />);
		fireEvent.click(screen.getByRole("switch", { name: "Developer tools" }));

		await waitFor(() => expect(confirmAsk).toHaveBeenCalledOnce());
		expect(useSettingsStore.getState().devMode).toBe(false);
	});

	it("opens generated component versions and licenses in a separate dialog", async () => {
		render(<AboutPanel />);

		expect(screen.queryByText("React")).toBeNull();
		fireEvent.click(
			screen.getByRole("button", { name: /open-source components/i }),
		);

		const dialog = await screen.findByRole("dialog", {
			name: "Open-source components",
		});
		expect(dialog).toBeDefined();
		expect(dialog.className).toContain("overflow-hidden");
		expect(screen.getByText("react")).toBeDefined();
		expect(screen.getAllByText("18.3.1").length).toBeGreaterThan(0);
		expect(screen.getByText("github.com/gin-gonic/gin")).toBeDefined();
		expect(screen.getAllByText("Apache-2.0").length).toBeGreaterThan(0);
		fireEvent.change(
			screen.getByPlaceholderText("Search packages, versions, or licenses"),
			{ target: { value: "github.com/gin-gonic/gin" } },
		);
		expect(screen.queryByText("react")).toBeNull();
		expect(screen.getByText("github.com/gin-gonic/gin")).toBeDefined();

		fireEvent.click(
			screen.getByRole("button", { name: "Close open-source components" }),
		);
		expect(screen.queryByText("React")).toBeNull();
	});
});
