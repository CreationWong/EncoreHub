export type SettingsLeaveGuard = () => Promise<boolean>;

let activeGuard: SettingsLeaveGuard | null = null;

export function registerSettingsLeaveGuard(
	guard: SettingsLeaveGuard,
): () => void {
	activeGuard = guard;
	return () => {
		if (activeGuard === guard) activeGuard = null;
	};
}

export function runAfterSettingsLeaveGuard(action: () => void): void {
	if (!activeGuard) {
		action();
		return;
	}
	void activeGuard().then((allowed) => {
		if (allowed) action();
	});
}
