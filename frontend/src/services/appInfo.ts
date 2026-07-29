import packageJson from "../../package.json";
import { inTauri } from "./devtools";
import { getRuntimePlatform } from "./runtimePlatform";

export interface AppBuildInfo {
	version: string;
	debug_build: boolean;
	target_os: string;
	target_arch: string;
}

export const FALLBACK_APP_VERSION = packageJson.version;

export function browserBuildInfo(): AppBuildInfo {
	return {
		version: FALLBACK_APP_VERSION,
		debug_build: import.meta.env.DEV,
		target_os: getRuntimePlatform(),
		target_arch: "browser",
	};
}

export async function getAppBuildInfo(): Promise<AppBuildInfo> {
	if (!inTauri()) return browserBuildInfo();
	try {
		const { invoke } = await import("@tauri-apps/api/core");
		return await invoke<AppBuildInfo>("get_app_info");
	} catch {
		return browserBuildInfo();
	}
}
