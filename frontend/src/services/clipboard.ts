import { inTauri } from "./devtools";

export function canReadClipboardText(): boolean {
	return inTauri() || Boolean(navigator.clipboard?.readText);
}

export async function readClipboardText(): Promise<string> {
	if (inTauri()) {
		const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
		return readText();
	}
	if (!navigator.clipboard?.readText) {
		throw new Error("Clipboard access is unavailable");
	}
	return navigator.clipboard.readText();
}

export async function writeClipboardText(text: string): Promise<void> {
	if (inTauri()) {
		const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
		await writeText(text);
		return;
	}
	if (!navigator.clipboard?.writeText) {
		throw new Error("Clipboard access is unavailable");
	}
	await navigator.clipboard.writeText(text);
}
