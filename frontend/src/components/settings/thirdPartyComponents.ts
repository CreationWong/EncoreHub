/**
 * Adapts the release-generated OSS manifest to the settings UI contract.
 * The JSON is regenerated for each desktop target before Tauri packaging.
 */
import manifest from "./thirdPartyComponents.generated.json";

/** Product layer that bundles or links a third-party component. */
export type ComponentLayer = "Interface" | "Desktop" | "Gateway" | "Engine";

/** Package manager ecosystem used to resolve a component. */
export type ComponentEcosystem = "npm" | "cargo" | "go";

/** One exact package version included in the target release dependency graph. */
export interface ThirdPartyComponent {
	ecosystem: ComponentEcosystem;
	layer: ComponentLayer;
	name: string;
	packageName: string;
	version: string;
	license: string;
}

interface GeneratedComplianceManifest {
	schemaVersion: number;
	releaseTarget: string;
	components: ThirdPartyComponent[];
}

const generated = manifest as GeneratedComplianceManifest;

/** Rust target triple used when resolving this generated release manifest. */
export const OSS_RELEASE_TARGET = generated.releaseTarget;

/** Complete production component closure for the generated release target. */
export const THIRD_PARTY_COMPONENTS = generated.components;

/** Stable presentation order for product layers. */
export const COMPONENT_LAYERS: ComponentLayer[] = [
	"Interface",
	"Desktop",
	"Gateway",
	"Engine",
];
