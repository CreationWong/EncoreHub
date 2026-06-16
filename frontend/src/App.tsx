import { Loader2, Wifi, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import ChatView from "./components/chat/ChatView";
import Sidebar from "./components/sidebar/Sidebar";
import { HEALTH_ENGINE, HEALTH_GATEWAY } from "./services/config";
import { useConversationStore } from "./stores/conversationStore";

type ServiceStatus = {
	engine: boolean;
	gateway: boolean;
};

export default function App() {
	const loadList = useConversationStore((s) => s.loadList);
	const [status, setStatus] = useState<ServiceStatus>({
		engine: false,
		gateway: false,
	});
	const [checking, setChecking] = useState(true);

	// Poll backend health on startup
	useEffect(() => {
		let attempts = 0;
		const maxAttempts = 60;

		const check = async () => {
			let engineOk = false;
			let gatewayOk = false;

			try {
				const res = await fetch(HEALTH_ENGINE);
				engineOk = res.ok;
			} catch {
				/* not ready */
			}

			try {
				const res = await fetch(HEALTH_GATEWAY);
				gatewayOk = res.ok;
			} catch {
				/* not ready */
			}

			setStatus({ engine: engineOk, gateway: gatewayOk });

			if ((engineOk && gatewayOk) || attempts >= maxAttempts) {
				setChecking(false);
				if (gatewayOk) loadList();
			} else {
				attempts++;
				setTimeout(check, 1000);
			}
		};

		check();
	}, [loadList]);

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
							className={`flex items-center gap-1.5 ${status.engine ? "text-green-400" : "text-text-muted"}`}
						>
							{status.engine ? (
								<Wifi className="h-3 w-3" />
							) : (
								<WifiOff className="h-3 w-3" />
							)}
							Engine {status.engine ? "ready" : "waiting..."}
						</span>
						<span
							className={`flex items-center gap-1.5 ${status.gateway ? "text-green-400" : "text-text-muted"}`}
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
		</div>
	);
}
