import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "../../stores/settingsStore";

const mocks = vi.hoisted(() => ({
	maximized: false,
	minimize: vi.fn(),
	toggleMaximize: vi.fn(),
	close: vi.fn(),
	isMaximized: vi.fn(),
	onResized: vi.fn(),
	unlisten: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("../../services/windowControls", () => ({
	getDesktopWindowController: async () => ({
		minimize: mocks.minimize,
		toggleMaximize: mocks.toggleMaximize,
		close: mocks.close,
		isMaximized: mocks.isMaximized,
		onResized: mocks.onResized,
	}),
}));

vi.mock("../../stores/toastStore", () => ({
	toast: { error: mocks.toastError },
}));

import WindowControls from "./WindowControls";

describe("WindowControls", () => {
	beforeEach(() => {
		mocks.maximized = false;
		mocks.minimize.mockReset().mockResolvedValue(undefined);
		mocks.toggleMaximize.mockReset().mockImplementation(async () => {
			mocks.maximized = !mocks.maximized;
		});
		mocks.close.mockReset().mockResolvedValue(undefined);
		mocks.isMaximized
			.mockReset()
			.mockImplementation(async () => mocks.maximized);
		mocks.unlisten.mockReset();
		mocks.onResized.mockReset().mockResolvedValue(mocks.unlisten);
		mocks.toastError.mockReset();
		useSettingsStore.setState({ trafficLightWindowControls: false });
	});

	afterEach(cleanup);

	it("renders no operating-system controls in web mode", () => {
		render(<WindowControls enabled={false} />);
		expect(screen.queryByRole("group", { name: "Window controls" })).toBeNull();
	});

	it("uses standard caption styling by default", () => {
		render(<WindowControls enabled />);

		const controls = screen.getByRole("group", { name: "Window controls" });
		expect(controls.getAttribute("data-window-control-style")).toBe("standard");
		expect(
			screen
				.getByRole("button", { name: "Minimize window" })
				.querySelector("span")?.className,
		).not.toContain("group-hover:bg-window-minimize");
	});

	it("uses macOS traffic-light colors when the optional style is enabled", () => {
		useSettingsStore.setState({ trafficLightWindowControls: true });
		render(<WindowControls enabled />);

		const minimize = screen.getByRole("button", { name: "Minimize window" });
		const maximize = screen.getByRole("button", { name: "Maximize window" });
		const close = screen.getByRole("button", { name: "Close window" });

		expect(
			screen
				.getByRole("group", { name: "Window controls" })
				.getAttribute("data-window-control-style"),
		).toBe("traffic-lights");
		expect(minimize.querySelector("span")?.className).toContain(
			"group-hover:bg-window-minimize",
		);
		expect(maximize.querySelector("span")?.className).toContain(
			"group-hover:bg-window-maximize",
		);
		expect(close.querySelector("span")?.className).toContain(
			"group-hover:bg-window-close",
		);
	});

	it("routes Windows caption commands through the current Tauri window", async () => {
		const { unmount } = render(<WindowControls enabled />);

		await waitFor(() => expect(mocks.isMaximized).toHaveBeenCalled());
		fireEvent.click(screen.getByRole("button", { name: "Minimize window" }));
		fireEvent.click(screen.getByRole("button", { name: "Maximize window" }));

		await waitFor(() => {
			expect(mocks.minimize).toHaveBeenCalledTimes(1);
			expect(mocks.toggleMaximize).toHaveBeenCalledTimes(1);
			expect(
				screen.getByRole("button", { name: "Restore window" }),
			).toBeDefined();
		});

		fireEvent.click(screen.getByRole("button", { name: "Close window" }));
		await waitFor(() => expect(mocks.close).toHaveBeenCalledTimes(1));
		unmount();
		expect(mocks.unlisten).toHaveBeenCalledTimes(1);
		expect(mocks.toastError).not.toHaveBeenCalled();
	});
});
