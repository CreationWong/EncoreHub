import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
	invoke: (...args: unknown[]) => invoke(...args),
}));

import {
	classifyRuntimePlatform,
	getCustomTitlebarEnabled,
} from "./runtimePlatform";

describe("classifyRuntimePlatform", () => {
	it("keeps plain browser sessions in web mode", () => {
		expect(classifyRuntimePlatform(false, "Win32")).toBe("web");
	});

	it.each([
		["Win32", "windows"],
		["Windows", "windows"],
		["MacIntel", "macos"],
		["Darwin", "macos"],
		["Linux x86_64", "linux"],
		["X11", "linux"],
		["unknown", "other"],
	] as const)("classifies %s as %s inside Tauri", (platform, expected) => {
		expect(classifyRuntimePlatform(true, platform)).toBe(expected);
	});
});

describe("getCustomTitlebarEnabled", () => {
	beforeEach(() => {
		invoke.mockReset();
		(
			window as unknown as { __TAURI_INTERNALS__?: object }
		).__TAURI_INTERNALS__ = {};
		vi.spyOn(window.navigator, "platform", "get").mockReturnValue("Win32");
		// jsdom derives userAgent from the host OS; on macOS it contains
		// "Macintosh" and would override the stubbed platform below.
		vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
		);
	});

	it("uses the desktop rollback decision", async () => {
		invoke.mockResolvedValue(false);

		await expect(getCustomTitlebarEnabled()).resolves.toBe(false);
		expect(invoke).toHaveBeenCalledTimes(1);
		expect(invoke).toHaveBeenCalledWith("use_custom_titlebar");
	});

	it("keeps controls available if an older desktop cannot answer", async () => {
		invoke.mockRejectedValue(new Error("command unavailable"));
		await expect(getCustomTitlebarEnabled()).resolves.toBe(true);
	});
});
