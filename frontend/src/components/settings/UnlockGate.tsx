import { Lock } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useSecretsStore } from "../../stores/secretsStore";
import { toast } from "../../stores/toastStore";

/**
 * Startup unlock overlay. Rendered when the secrets database is encrypted but
 * locked — the user must enter the master password before stored keys can be
 * used. Dismissable (the user can browse history / chat with session-entered
 * keys without unlocking), but reappears until unlocked.
 */
export default function UnlockGate() {
	const encrypted = useSecretsStore((s) => s.encrypted);
	const unlocked = useSecretsStore((s) => s.unlocked);
	const loaded = useSecretsStore((s) => s.loaded);
	const unlock = useSecretsStore((s) => s.unlock);

	const [pw, setPw] = useState("");
	const [busy, setBusy] = useState(false);
	const [dismissed, setDismissed] = useState(false);

	if (!loaded || !encrypted || unlocked || dismissed) return null;

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		setBusy(true);
		try {
			await unlock(pw);
			setPw("");
			toast.success("Unlocked");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Incorrect password");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
			<dialog
				open
				aria-modal="true"
				className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 text-text-primary shadow-2xl"
			>
				<div className="mb-4 flex items-center gap-3">
					<div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10">
						<Lock className="h-5 w-5 text-accent" />
					</div>
					<div>
						<h2 className="text-sm font-semibold">Unlock EncoreHub</h2>
						<p className="text-xs text-text-muted">
							Enter your master password to use stored API keys.
						</p>
					</div>
				</div>
				<form onSubmit={submit} className="space-y-3">
					<input
						autoComplete="off"
						type="password"
						value={pw}
						onChange={(e) => setPw(e.target.value)}
						placeholder="Master password"
						// biome-ignore lint/a11y/noAutofocus: unlock prompt should focus immediately
						autoFocus
						className="w-full rounded-lg border border-border bg-surface-alt px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
					/>
					<div className="flex gap-2">
						<button
							type="submit"
							disabled={busy || !pw}
							className="flex-1 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-40"
						>
							Unlock
						</button>
						<button
							type="button"
							onClick={() => setDismissed(true)}
							className="rounded-lg border border-border px-3 py-2 text-sm text-text-secondary hover:bg-surface-hover"
						>
							Later
						</button>
					</div>
				</form>
			</dialog>
		</div>
	);
}
