import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	canReadClipboardText,
	readClipboardText,
	writeClipboardText,
} from "./clipboard";

const mocks = vi.hoisted(() => ({
	desktop: false,
	readText: vi.fn(),
	writeText: vi.fn(),
}));

vi.mock("./devtools", () => ({
	inTauri: () => mocks.desktop,
}));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
	readText: (...args: unknown[]) => mocks.readText(...args),
	writeText: (...args: unknown[]) => mocks.writeText(...args),
}));

describe("clipboard service", () => {
	beforeEach(() => {
		mocks.desktop = false;
		mocks.readText.mockReset().mockResolvedValue("desktop text");
		mocks.writeText.mockReset().mockResolvedValue(undefined);
	});

	it("uses the Tauri plugin in the desktop app", async () => {
		mocks.desktop = true;

		expect(canReadClipboardText()).toBe(true);
		await expect(readClipboardText()).resolves.toBe("desktop text");
		await writeClipboardText("copy me");

		expect(mocks.readText).toHaveBeenCalledOnce();
		expect(mocks.writeText).toHaveBeenCalledWith("copy me");
	});

	it("falls back to the Web Clipboard API in browser previews", async () => {
		const browserRead = vi.fn().mockResolvedValue("browser text");
		const browserWrite = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { readText: browserRead, writeText: browserWrite },
		});

		expect(canReadClipboardText()).toBe(true);
		await expect(readClipboardText()).resolves.toBe("browser text");
		await writeClipboardText("copy me");

		expect(browserRead).toHaveBeenCalledOnce();
		expect(browserWrite).toHaveBeenCalledWith("copy me");
		expect(mocks.readText).not.toHaveBeenCalled();
		expect(mocks.writeText).not.toHaveBeenCalled();
	});
});
