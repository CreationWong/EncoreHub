import { Loader2, Wifi, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import ChatView from "./components/chat/ChatView";
import SettingsModal from "./components/settings/SettingsModal";
import UnlockGate from "./components/settings/UnlockGate";
import Sidebar from "./components/sidebar/Sidebar";
import ToastHost from "./components/ui/ToastHost";
import { applyServicePorts, healthGatewayUrl } from "./services/config";
import { inTauri } from "./services/devtools";
import { useConversationStore } from "./stores/conversationStore";
import { useProviderStore } from "./stores/providerStore";
import { useSecretsStore } from "./stores/secretsStore";
import { useSettingsStore } from "./stores/settingsStore";

type ServiceStatus = {
	engine: boolean;
	gateway: boolean;
};

export default function App() {
	const loadList = useConversationStore((s) => s.loadList);
	const loadProviders = useProviderStore((s) => s.load);
	const refreshSecrets = useSecretsStore((s) => s.refresh);
	const loadKeys = useSettingsStore((s) => s.loadKeys);
	const openSettings = useSettingsStore((s) => s.openSettings);
	const [status, setStatus] = useState<ServiceStatus>({
		engine: false,
		gateway: false,
	});
	const [checking, setChecking] = useState(true);

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
					const ports = await invoke<{ engine_port: number; gateway_port: number }>(
						"get_service_ports",
					);
					if (!cancelled) {
						applyServicePorts(ports.gateway_port, ports.engine_port);
					}
				} catch (e) {
					console.warn("Failed to resolve Tauri ports, using defaults:", e);
				}
			}
			// In non-Tauri mode (dev), VITE_GATEWAY_URL / VITE_ENGINE_URL env vars
			// are already baked into the defaults — no action needed.
		}

		resolvePorts();
		return () => { cancelled = true; };
	}, []);

	// Poll backend health on startup
	useEffect(() => {
		let attempts = 0;
		const maxAttempts = 60;

		const check = async () => {
			let engineOk = false;
			let gatewayOk = false;

			// The gateway is the single entry point (frontend → gateway → engine).
			// Its /health payload reports engine readiness via `engine.ok`, so we
			// derive both from one request rather than reaching into the engine
			// port directly — a direct fetch to :3000 from the packaged webview is
			// unreliable, and gating the splash on it can hang startup forever.
			try {
				const res = await fetch(healthGatewayUrl());
				gatewayOk = res.ok;
				if (res.ok) {
					const body = await res.json().catch(() => null);
					engineOk = body?.engine?.ok === true;
				}
			} catch {
				/* not ready */
			}

			setStatus({ engine: engineOk, gateway: gatewayOk });

			// Proceed once the gateway is up (engine may still be warming up).
			// Don't block the UI on engine readiness — features that need it will
			// surface their own errors, and the developer panel shows live status.
			if (gatewayOk || attempts >= maxAttempts) {
				setChecking(false);
				if (gatewayOk) {
					loadList();
					loadProviders();
					refreshSecrets();
					loadKeys();
				}
			} else {
				attempts++;
				setTimeout(check, 1000);
			}
		};

		check();
	}, [loadList, loadProviders, refreshSecrets, loadKeys]);

	// Splash screen while waiting for backend
	if (checking) {
		return (
			<div className="flex h-screen items-center justify-center bg-surface">
				<div className="text-center space-y-6">
					<div className="flex justify-center">
						<div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10">
							<Loader2 className="h-8 w-8 text-accent animate-spin" />
						</div>
					</div>
					<h2 className="text-xl font-semibold text-text-primary">EncoreHub</h2>
					<p className="text-sm text-text-muted">Starting services...</p>
					<div className="flex items-center justify-center gap-4 text-xs">
						<span
							className={`flex items-center gap-1.5 ${status.engine ? "text-success" : "text-text-muted"}`}
						>
							{status.engine ? (
								<Wifi className="h-3 w-3" />
							) : (
								<WifiOff className="h-3 w-3" />
							)}
							Engine {status.engine ? "ready" : "waiting..."}
						</span>
						<span
							className={`flex items-center gap-1.5 ${status.gateway ? "text-success" : "text-text-muted"}`}
						>
							{status.gateway ? (
								<Wifi className="h-3 w-3" />
							) : (
								<WifiOff className="h-3 w-3" />
							)}
							Gateway {status.gateway ? "ready" : "waiting..."}
						</span>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="flex h-screen overflow-hidden bg-surface text-text-primary">
			<Sidebar />
			<main className="flex-1 flex flex-col min-w-0">
				<ChatView />
			</main>
			<SettingsModal />
			<UnlockGate />
			<ToastHost />
		</div>
	);
}
