import { inTauri } from "./devtools";

export type RuntimePlatform = "web" | "windows" | "macos" | "linux" | "other";

export function classifyRuntimePlatform(
	desktopRuntime: boolean,
	platform: string,
): RuntimePlatform {
	if (!desktopRuntime) return "web";
	const value = platform.toLowerCase();
	if (value.includes("mac")) return "macos";
	if (value.includes("darwin")) return "macos";
	if (
		value.includes("windows") ||
		value.includes("win32") ||
		value.includes("win64")
	)
		return "windows";
	if (value.includes("linux") || value.includes("x11")) return "linux";
	return "other";
}

function navigatorPlatform(): string {
	if (typeof navigator === "undefined") return "";
	const userAgentData = (
		navigator as Navigator & { userAgentData?: { platform?: string } }
	).userAgentData;
	return [userAgentData?.platform, navigator.platform, navigator.userAgent]
		.filter(Boolean)
		.join(" ");
}

export function getRuntimePlatform(): RuntimePlatform {
	return classifyRuntimePlatform(inTauri(), navigatorPlatform());
}

export async function getCustomTitlebarEnabled(): Promise<boolean> {
	if (getRuntimePlatform() !== "windows") return false;
	return import("@tauri-apps/api/core")
		.then(({ invoke }) => invoke<boolean>("use_custom_titlebar"))
		.catch(() => true);
}
