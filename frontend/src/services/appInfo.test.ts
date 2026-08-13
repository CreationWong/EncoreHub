import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	desktop: false,
	invoke: vi.fn(),
	platform: "web",
}));

vi.mock("./devtools", () => ({
	inTauri: () => mocks.desktop,
}));

vi.mock("./runtimePlatform", () => ({
	getRuntimePlatform: () => mocks.platform,
}));

vi.mock("@tauri-apps/api/core", () => ({
	invoke: (...args: unknown[]) => mocks.invoke(...args),
}));

import {
	FALLBACK_APP_VERSION,
	browserBuildInfo,
	formatDisplayVersion,
	getAppBuildInfo,
} from "./appInfo";

describe("appInfo", () => {
	beforeEach(() => {
		mocks.desktop = false;
		mocks.platform = "web";
		mocks.invoke.mockReset();
	});

	it("provides package metadata in a plain browser", async () => {
		expect(browserBuildInfo()).toMatchObject({
			version: FALLBACK_APP_VERSION,
			build_id: expect.stringMatching(/^\d{12}$/),
			target_os: "web",
			target_arch: "browser",
		});
		await expect(getAppBuildInfo()).resolves.toMatchObject({
			version: FALLBACK_APP_VERSION,
			target_os: "web",
		});
		expect(mocks.invoke).not.toHaveBeenCalled();
	});

	it("uses authoritative desktop build metadata in Tauri", async () => {
		mocks.desktop = true;
		mocks.invoke.mockResolvedValue({
			version: "1.2.3",
			build_id: "260813600474",
			public_version: "V1.2.3",
			debug_build: false,
			target_os: "windows",
			target_arch: "x86_64",
		});

		await expect(getAppBuildInfo()).resolves.toEqual({
			version: "1.2.3",
			build_id: "260813600474",
			public_version: "V1.2.3",
			debug_build: false,
			target_os: "windows",
			target_arch: "x86_64",
		});
		expect(mocks.invoke).toHaveBeenCalledWith("get_app_info");
	});

	it("always shows Build ID while hiding patch tier outside diagnostics", () => {
		expect(formatDisplayVersion("V0.1.25.142", "260813600474", false)).toBe(
			"V0.1.25 (Build 260813600474)",
		);
		expect(formatDisplayVersion("V0.1.25.142", "260813600474", true)).toBe(
			"V0.1.25.142 (Build 260813600474)",
		);
	});

	it("falls back without failing when an older desktop lacks the command", async () => {
		mocks.desktop = true;
		mocks.platform = "windows";
		mocks.invoke.mockRejectedValue(new Error("command unavailable"));

		await expect(getAppBuildInfo()).resolves.toMatchObject({
			version: FALLBACK_APP_VERSION,
			target_os: "windows",
		});
	});
});
