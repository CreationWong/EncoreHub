import { Copy, Minus, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	type DesktopWindowController,
	getDesktopWindowController,
} from "../../services/windowControls";
import { useSettingsStore } from "../../stores/settingsStore";
import { toast } from "../../stores/toastStore";

const WINDOW_ACTION_ERROR = "Unable to control the application window.";

export default function WindowControls({ enabled }: { enabled: boolean }) {
	const controllerRef = useRef<DesktopWindowController | null>(null);
	const [maximized, setMaximized] = useState(false);
	const trafficLights = useSettingsStore(
		(state) => state.trafficLightWindowControls,
	);

	const syncMaximized = useCallback(
		async (controller: DesktopWindowController) => {
			setMaximized(await controller.isMaximized());
		},
		[],
	);

	useEffect(() => {
		if (!enabled) return;
		let disposed = false;
		let unlisten: (() => void) | undefined;

		void getDesktopWindowController()
			.then(async (controller) => {
				if (disposed) return;
				controllerRef.current = controller;
				await syncMaximized(controller);
				if (disposed) return;
				unlisten = await controller.onResized(() => {
					void syncMaximized(controller);
				});
			})
			.catch(() => {
				if (!disposed) toast.error(WINDOW_ACTION_ERROR);
			});

		return () => {
			disposed = true;
			unlisten?.();
			controllerRef.current = null;
		};
	}, [enabled, syncMaximized]);

	const run = async (
		action: (controller: DesktopWindowController) => Promise<void>,
		refresh = false,
	) => {
		try {
			const controller =
				controllerRef.current ?? (await getDesktopWindowController());
			controllerRef.current = controller;
			await action(controller);
			if (refresh) await syncMaximized(controller);
		} catch {
			toast.error(WINDOW_ACTION_ERROR);
		}
	};

	if (!enabled) return null;

	return (
		<fieldset
			aria-label="Window controls"
			data-window-control-style={trafficLights ? "traffic-lights" : "standard"}
			className="m-0 ml-1 flex h-full shrink-0 items-stretch border-0 border-l border-border p-0"
		>
			<button
				type="button"
				onClick={() => void run((controller) => controller.minimize())}
				aria-label="Minimize window"
				title="Minimize"
				className={`group flex h-full w-11 items-center justify-center text-text-secondary transition-colors ${
					trafficLights ? "" : "hover:bg-control hover:text-text-primary"
				}`}
			>
				<span
					aria-hidden="true"
					className={`flex h-5 w-5 items-center justify-center transition-colors ${
						trafficLights
							? "rounded-full group-hover:bg-window-minimize group-hover:text-window-symbol"
							: "rounded-sm"
					}`}
				>
					<Minus className="h-4 w-4" strokeWidth={1.7} />
				</span>
			</button>
			<button
				type="button"
				onClick={() =>
					void run((controller) => controller.toggleMaximize(), true)
				}
				aria-label={maximized ? "Restore window" : "Maximize window"}
				title={maximized ? "Restore" : "Maximize"}
				className={`group flex h-full w-11 items-center justify-center text-text-secondary transition-colors ${
					trafficLights ? "" : "hover:bg-control hover:text-text-primary"
				}`}
			>
				<span
					aria-hidden="true"
					className={`flex h-5 w-5 items-center justify-center transition-colors ${
						trafficLights
							? "rounded-full group-hover:bg-window-maximize group-hover:text-window-symbol"
							: "rounded-sm"
					}`}
				>
					{maximized ? (
						<Copy className="h-3.5 w-3.5" strokeWidth={1.7} />
					) : (
						<Square className="h-3.5 w-3.5" strokeWidth={1.7} />
					)}
				</span>
			</button>
			<button
				type="button"
				onClick={() => void run((controller) => controller.close())}
				aria-label="Close window"
				title="Close"
				className={`group flex h-full w-11 items-center justify-center text-text-secondary transition-colors ${
					trafficLights ? "" : "hover:bg-danger-bg hover:text-danger"
				}`}
			>
				<span
					aria-hidden="true"
					className={`flex h-5 w-5 items-center justify-center transition-colors ${
						trafficLights
							? "rounded-full group-hover:bg-window-close group-hover:text-window-symbol"
							: "rounded-sm"
					}`}
				>
					<X className="h-4 w-4" strokeWidth={1.7} />
				</span>
			</button>
		</fieldset>
	);
}
