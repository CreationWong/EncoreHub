import versionRecord from "../../version.json";
import { inTauri } from "./devtools";
import { getRuntimePlatform } from "./runtimePlatform";

type VersionParts = {
	major: number;
	compatibility: number;
	feature: number;
	patch: number;
};

const COMPONENT_VERSION = versionRecord.version;
const BUILD_ID = import.meta.env.VITE_BUILD_ID ?? buildIdNow();

export interface AppBuildInfo {
	version: string;
	build_id: string;
	public_version: string;
	debug_build: boolean;
	target_os: string;
	target_arch: string;
}

export const FALLBACK_APP_VERSION = COMPONENT_VERSION;
export const FRONTEND_VERSION_RECORD = {
	...versionRecord,
	build_id: BUILD_ID,
};

function buildIdNow(): string {
	const now = new Date();
	const pad = (value: number) => String(value).padStart(2, "0");
	const date = `${pad(now.getUTCFullYear() % 100)}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
	return `${date}${String(Math.floor(now.getTime() / 1000)).slice(-6)}`;
}

export function formatDisplayVersion(
	version: string,
	buildId: string,
	diagnostic: boolean,
): string {
	const parsed = version.match(/^V(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
	if (!parsed) return `${version} (Build ${buildId})`;
	const publicVersion = `V${parsed[1]}.${parsed[2]}.${parsed[3]}`;
	return `${diagnostic ? version : publicVersion} (Build ${buildId})`;
}

export function parseVersion(version: string): VersionParts | null {
	const match = version.match(/^V(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
	return match
		? {
				major: Number(match[1]),
				compatibility: Number(match[2]),
				feature: Number(match[3]),
				patch: Number(match[4]),
			}
		: null;
}

export function versionInRange(
	version: string,
	range: { min: string; max_exclusive: string },
): boolean {
	const value = parseVersion(version);
	const min = parseVersion(range.min);
	const max = parseVersion(range.max_exclusive);
	if (!value || !min || !max) return false;
	const compare = (left: VersionParts, right: VersionParts) =>
		[left.major, left.compatibility, left.feature, left.patch]
			.map(
				(part, index) =>
					part -
					[right.major, right.compatibility, right.feature, right.patch][index],
			)
			.find((difference) => difference !== 0) ?? 0;
	return compare(value, min) >= 0 && compare(value, max) < 0;
}

export function verifyMutualCompatibility(
	local: {
		component: string;
		version: string;
		build_id?: string;
		compatibility: Record<string, { min: string; max_exclusive: string }>;
	},
	peer: {
		component: string;
		version: string;
		build_id?: string;
		compatibility: Record<string, { min: string; max_exclusive: string }>;
	},
): string | null {
	const identity = (record: {
		component: string;
		version: string;
		build_id?: string;
	}) =>
		`${record.component} ${record.version} (Build ${record.build_id ?? "unknown"})`;
	const localRange = local.compatibility[peer.component];
	if (!localRange || !versionInRange(peer.version, localRange)) {
		return `${identity(local)} rejects ${identity(peer)}`;
	}
	const peerRange = peer.compatibility[local.component];
	if (!peerRange || !versionInRange(local.version, peerRange)) {
		return `${identity(peer)} rejects ${identity(local)}`;
	}
	return null;
}

export function browserBuildInfo(): AppBuildInfo {
	return {
		version: FALLBACK_APP_VERSION,
		build_id: BUILD_ID,
		public_version: formatDisplayVersion(FALLBACK_APP_VERSION, BUILD_ID, false),
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
