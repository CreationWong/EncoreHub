export interface DesktopWindowController {
	minimize: () => Promise<void>;
	toggleMaximize: () => Promise<void>;
	close: () => Promise<void>;
	isMaximized: () => Promise<boolean>;
	onResized: (handler: () => void) => Promise<() => void>;
}

export async function getDesktopWindowController(): Promise<DesktopWindowController> {
	const { getCurrentWindow } = await import("@tauri-apps/api/window");
	const appWindow = getCurrentWindow();
	return {
		minimize: () => appWindow.minimize(),
		toggleMaximize: () => appWindow.toggleMaximize(),
		close: () => appWindow.close(),
		isMaximized: () => appWindow.isMaximized(),
		onResized: (handler) => appWindow.onResized(handler),
	};
}

export async function toggleCurrentWindowMaximize(): Promise<void> {
	const controller = await getDesktopWindowController();
	await controller.toggleMaximize();
}
