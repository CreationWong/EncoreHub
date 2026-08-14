/** Owns desktop startup orchestration and top-level application composition. */
import { WifiOff } from "lucide-react";
import { Suspense, lazy, useEffect, useState } from "react";
import GlobalNav from "./components/layout/GlobalNav";
import UnlockGate from "./components/settings/UnlockGate";
import StartupScreen from "./components/startup/StartupScreen";
import AppContextMenu from "./components/ui/AppContextMenu";
import ConfirmDialog from "./components/ui/ConfirmDialog";
import ToastHost from "./components/ui/ToastHost";
import WorkspaceSurface from "./components/workspace/WorkspaceSurface";
import {
	FRONTEND_VERSION_RECORD,
	verifyMutualCompatibility,
} from "./services/appInfo";
import { applyServicePorts, gatewayReadinessUrl } from "./services/config";
import { devtools, inTauri } from "./services/devtools";
import { useCharacterManagerStore } from "./stores/characterManagerStore";
import { useCharacterStore } from "./stores/characterStore";
import { useConversationStore } from "./stores/conversationStore";
import { useProviderStore } from "./stores/providerStore";
import { useSecretsStore } from "./stores/secretsStore";
import { useSettingsStore } from "./stores/settingsStore";

/** Readiness state reported by the local gateway and embedded engine. */
type ServiceStatus = {
	engine: boolean;
	gateway: boolean;
	compatibilityError?: string;
};

const CharacterManager = lazy(
	() => import("./components/character/CharacterManager"),
);

/** Coordinates desktop startup, global services, and the steady-state workspace. */
export default function App() {
	const loadList = useConversationStore((s) => s.loadList);
	const loadCharacters = useCharacterStore((s) => s.load);
	const loadProviders = useProviderStore((s) => s.load);
	const refreshSecrets = useSecretsStore((s) => s.refresh);
	const loadKeys = useSettingsStore((s) => s.loadKeys);
	const loadWebSearchSettings = useSettingsStore(
		(s) => s.loadWebSearchSettings,
	);
	const openSettings = useSettingsStore((s) => s.openSettings);
	const characterManagerOpen = useCharacterManagerStore((s) => s.open);
	const devMode = useSettingsStore((s) => s.devMode);
	const fullCommunicationLogs = useSettingsStore(
		(s) => s.fullCommunicationLogs,
	);
	const setFullCommunicationLogs = useSettingsStore(
		(s) => s.setFullCommunicationLogs,
	);
	const [status, setStatus] = useState<ServiceStatus>({
		engine: false,
		gateway: false,
	});
	const [checking, setChecking] = useState(true);
	const [compatibilityError, setCompatibilityError] = useState<string | null>(
		null,
	);
	const [portsReady, setPortsReady] = useState(() => !inTauri());

	useEffect(() => {
		if (!inTauri()) return;
		void (async () => {
			try {
				await devtools.setDeveloperMode(devMode);
				const applied = await devtools.setFullCommunicationLogs(
					devMode && fullCommunicationLogs,
				);
				if (applied !== fullCommunicationLogs) {
					setFullCommunicationLogs(applied);
				}
			} catch (error) {
				console.error("Failed to synchronize developer feature state", error);
			}
		})();
	}, [devMode, fullCommunicationLogs, setFullCommunicationLogs]);

	// Cmd/Ctrl + , opens Settings — convention from VS Code / Chrome.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === ",") {
				e.preventDefault();
				openSettings();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [openSettings]);

	// Resolve service ports. In Tauri they are negotiated at startup; in dev mode
	// they come from Vite env vars (or the hardcoded defaults).
	useEffect(() => {
		let cancelled = false;

		async function resolvePorts() {
			if (inTauri()) {
				try {
					// Dynamic import so Vite doesn't bundle @tauri-apps/api in the web build.
					const { invoke } = await import("@tauri-apps/api/core");
					const ports = await invoke<{ gateway_port: number }>(
						"get_service_ports",
					);
					if (!cancelled) {
						applyServicePorts(ports.gateway_port);
					}
				} catch (e) {
					console.warn("Failed to resolve Tauri ports, using defaults:", e);
				} finally {
					if (!cancelled) setPortsReady(true);
				}
			} else if (!cancelled) {
				setPortsReady(true);
			}
			// In non-Tauri mode, VITE_GATEWAY_URL is already the default.
		}

		void resolvePorts();
		return () => {
			cancelled = true;
		};
	}, []);

	// Poll backend health on startup
	useEffect(() => {
		if (!portsReady) return;

		let attempts = 0;
		const maxAttempts = 60;
		let timer: ReturnType<typeof setTimeout> | null = null;
		let cancelled = false;

		const check = async () => {
			if (cancelled) return;

			let engineOk = false;
			let gatewayOk = false;

			// The gateway is the single entry point (frontend → gateway → engine).
			// Its readiness payload reports Engine database state via `engine.ok`, so we
			// derive both from one request rather than reaching into the engine
			// port directly — a direct fetch to :3000 from the packaged webview is
			// unreliable, and gating the splash on it can hang startup forever.
			try {
				const res = await fetch(gatewayReadinessUrl());
				if (res.ok) {
					const body = await res.json().catch(() => null);
					const gatewayInfo = body?.version_info;
					const engineInfo = body?.engine?.version_info;
					const frontendInfo = FRONTEND_VERSION_RECORD;
					const compatibilityError =
						gatewayInfo && engineInfo
							? (verifyMutualCompatibility(frontendInfo, gatewayInfo) ??
								verifyMutualCompatibility(frontendInfo, engineInfo) ??
								verifyMutualCompatibility(gatewayInfo, engineInfo))
							: "Version metadata unavailable";
					engineOk = body?.engine?.ok === true && !compatibilityError;
					gatewayOk = engineOk;
					if (compatibilityError) {
						console.error("Version compatibility failed", compatibilityError);
						setCompatibilityError(compatibilityError);
						setChecking(false);
						return;
					}
				}
			} catch {
				/* not ready */
			}

			if (cancelled) return;
			setStatus({ engine: engineOk, gateway: gatewayOk });

			// Proceed only after Gateway and its Engine dependency are ready.
			if (gatewayOk || attempts >= maxAttempts) {
				setChecking(false);
				if (gatewayOk) {
					await Promise.allSettled([
						loadList(),
						loadCharacters(),
						loadProviders(),
						refreshSecrets(),
						loadKeys(),
						loadWebSearchSettings(),
					]);
				}
			} else {
				attempts++;
				timer = setTimeout(() => {
					void check();
				}, 1000);
			}
		};

		void check();
		return () => {
			cancelled = true;
			if (timer) clearTimeout(timer);
		};
	}, [
		portsReady,
		loadList,
		loadCharacters,
		loadProviders,
		refreshSecrets,
		loadKeys,
		loadWebSearchSettings,
	]);

	if (compatibilityError) {
		return (
			<div className="flex h-screen items-center justify-center bg-app-canvas p-6 text-text-primary">
				<div className="max-w-lg text-center">
					<WifiOff className="mx-auto h-9 w-9 text-danger" />
					<h2 className="mt-4 text-lg font-semibold">
						Incompatible components
					</h2>
					<p className="mt-2 text-sm text-text-secondary">
						{compatibilityError}
					</p>
				</div>
			</div>
		);
	}

	// Splash screen while waiting for backend
	if (checking) {
		return (
			<>
				<StartupScreen
					portsReady={portsReady}
					engineReady={status.engine}
					gatewayReady={status.gateway}
				/>
				<AppContextMenu />
			</>
		);
	}

	return (
		<div className="flex h-screen min-h-0 flex-col overflow-hidden bg-app-canvas text-text-primary">
			<GlobalNav />
			<WorkspaceSurface />
			{characterManagerOpen && (
				<Suspense fallback={null}>
					<CharacterManager />
				</Suspense>
			)}
			<UnlockGate />
			<ConfirmDialog />
			<ToastHost />
			<AppContextMenu />
		</div>
	);
}
