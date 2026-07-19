import {
	KeyRound,
	Lock,
	LockOpen,
	ShieldAlert,
	ShieldCheck,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { confirm } from "../../stores/confirmStore";
import { useSecretsStore } from "../../stores/secretsStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { toast } from "../../stores/toastStore";

/**
 * Security panel: master-password encryption for stored provider API keys.
 *
 * Protects keys **at rest** — an attacker with the database file cannot read
 * them without the password. It does NOT protect a running, unlocked session.
 * The copy here states that honestly and warns that a forgotten password is
 * unrecoverable.
 */
export default function SecurityPanel() {
	const {
		encrypted,
		unlocked,
		loaded,
		refresh,
		enable,
		disable,
		unlock,
		lock,
		resetPassword,
		clear,
	} = useSecretsStore();
	const apiKeys = useSettingsStore((s) => s.apiKeys);

	useEffect(() => {
		refresh();
	}, [refresh]);

	return (
		<div className="space-y-6">
			<StatusBanner encrypted={encrypted} unlocked={unlocked} loaded={loaded} />

			{!encrypted && (
				<EnableSection
					onEnable={async (pw) => {
						// Seed the keys currently held in session memory so they get
						// encrypted at rest rather than lost.
						await enable(pw, apiKeys);
						toast.success(
							"Encryption enabled — keys are now encrypted at rest",
						);
					}}
				/>
			)}

			{encrypted && !unlocked && (
				<UnlockSection
					onUnlock={async (pw) => {
						await unlock(pw);
						toast.success("Database unlocked for this session");
					}}
				/>
			)}

			{encrypted && unlocked && (
				<>
					<LockSection
						onLock={async () => {
							await lock();
							toast.info("Database locked");
						}}
					/>
					<ResetSection
						onReset={async (oldPw, newPw) => {
							await resetPassword(oldPw, newPw);
							toast.success("Master password changed");
						}}
					/>
					<DisableSection
						onDisable={async (pw) => {
							await disable(pw);
							toast.info("Encryption disabled — keys stored as plaintext");
						}}
					/>
				</>
			)}

			{encrypted && (
				<DangerSection
					onClear={async () => {
						await clear();
						toast.info("All stored keys cleared");
					}}
				/>
			)}
		</div>
	);
}

function StatusBanner({
	encrypted,
	unlocked,
	loaded,
}: {
	encrypted: boolean;
	unlocked: boolean;
	loaded: boolean;
}) {
	if (!loaded) {
		return (
			<p className="text-xs text-text-muted">Checking encryption status…</p>
		);
	}
	const Icon = !encrypted ? ShieldAlert : unlocked ? ShieldCheck : Lock;
	const tone = !encrypted
		? "text-warning"
		: unlocked
			? "text-success"
			: "text-text-secondary";
	const label = !encrypted
		? "Not encrypted — keys are stored as plaintext on disk"
		: unlocked
			? "Encrypted and unlocked for this session"
			: "Encrypted — locked, unlock to use stored keys";
	return (
		<div className="flex items-center gap-2 rounded-lg border border-border bg-surface-alt/40 px-3 py-2.5">
			<Icon className={`h-4 w-4 shrink-0 ${tone}`} />
			<span className="text-sm text-text-secondary">{label}</span>
		</div>
	);
}

function Section({
	title,
	desc,
	children,
}: {
	title: string;
	desc?: string;
	children: React.ReactNode;
}) {
	return (
		<section>
			<h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
				{title}
			</h3>
			{desc && <p className="mb-3 text-xs text-text-muted">{desc}</p>}
			{children}
		</section>
	);
}

function PasswordInput({
	id,
	value,
	onChange,
	placeholder,
	autoFocus,
}: {
	id: string;
	value: string;
	onChange: (v: string) => void;
	placeholder: string;
	autoFocus?: boolean;
}) {
	return (
		<input
			id={id}
			type="password"
			value={value}
			onChange={(e) => onChange(e.target.value)}
			placeholder={placeholder}
			// biome-ignore lint/a11y/noAutofocus: focusing the field is expected on an unlock prompt
			autoFocus={autoFocus}
			className="w-full rounded-lg border border-border bg-surface-alt px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
		/>
	);
}

function PrimaryButton({
	children,
	disabled,
	icon: Icon,
}: {
	children: React.ReactNode;
	disabled?: boolean;
	icon?: typeof Lock;
}) {
	return (
		<button
			type="submit"
			disabled={disabled}
			className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
		>
			{Icon && <Icon className="h-4 w-4" />}
			{children}
		</button>
	);
}

async function run(action: () => Promise<void>, setBusy: (b: boolean) => void) {
	setBusy(true);
	try {
		await action();
	} catch (e) {
		toast.error(e instanceof Error ? e.message : "Operation failed");
	} finally {
		setBusy(false);
	}
}

function EnableSection({
	onEnable,
}: { onEnable: (pw: string) => Promise<void> }) {
	const [pw, setPw] = useState("");
	const [confirm, setConfirm] = useState("");
	const [busy, setBusy] = useState(false);

	const submit = (e: FormEvent) => {
		e.preventDefault();
		if (pw !== confirm) {
			toast.error("Passwords do not match");
			return;
		}
		if (pw.length < 8) {
			toast.error("Use a password of at least 8 characters");
			return;
		}
		run(async () => {
			await onEnable(pw);
			setPw("");
			setConfirm("");
		}, setBusy);
	};

	return (
		<Section
			title="Enable encryption"
			desc="Set a master password to encrypt your API keys at rest. You'll enter it each time you open the app. This protects keys if your database file is stolen — it does not protect an already-unlocked session."
		>
			<form onSubmit={submit} className="space-y-2">
				<PasswordInput
					id="enc-pw"
					value={pw}
					onChange={setPw}
					placeholder="Master password (min 8 chars)"
				/>
				<PasswordInput
					id="enc-pw-confirm"
					value={confirm}
					onChange={setConfirm}
					placeholder="Confirm password"
				/>
				<p className="flex items-start gap-1.5 text-xs text-warning">
					<ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
					If you forget this password it cannot be recovered — you'll have to
					clear and re-enter your keys.
				</p>
				<PrimaryButton disabled={busy || !pw} icon={Lock}>
					Enable encryption
				</PrimaryButton>
			</form>
		</Section>
	);
}

function UnlockSection({
	onUnlock,
}: { onUnlock: (pw: string) => Promise<void> }) {
	const [pw, setPw] = useState("");
	const [busy, setBusy] = useState(false);

	const submit = (e: FormEvent) => {
		e.preventDefault();
		run(async () => {
			await onUnlock(pw);
			setPw("");
		}, setBusy);
	};

	return (
		<Section
			title="Unlock"
			desc="Enter your master password to use stored keys this session."
		>
			<form onSubmit={submit} className="space-y-2">
				<PasswordInput
					id="unlock-pw"
					value={pw}
					onChange={setPw}
					placeholder="Master password"
					autoFocus
				/>
				<PrimaryButton disabled={busy || !pw} icon={LockOpen}>
					Unlock
				</PrimaryButton>
			</form>
		</Section>
	);
}

function LockSection({ onLock }: { onLock: () => Promise<void> }) {
	const [busy, setBusy] = useState(false);
	return (
		<Section
			title="Lock"
			desc="Drop the cached key now. You'll need the password again to chat."
		>
			<button
				type="button"
				disabled={busy}
				onClick={() => run(onLock, setBusy)}
				className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
			>
				<Lock className="h-4 w-4" />
				Lock now
			</button>
		</Section>
	);
}

function ResetSection({
	onReset,
}: {
	onReset: (oldPw: string, newPw: string) => Promise<void>;
}) {
	const [oldPw, setOldPw] = useState("");
	const [newPw, setNewPw] = useState("");
	const [confirm, setConfirm] = useState("");
	const [busy, setBusy] = useState(false);

	const submit = (e: FormEvent) => {
		e.preventDefault();
		if (newPw !== confirm) {
			toast.error("New passwords do not match");
			return;
		}
		if (newPw.length < 8) {
			toast.error("Use a password of at least 8 characters");
			return;
		}
		run(async () => {
			await onReset(oldPw, newPw);
			setOldPw("");
			setNewPw("");
			setConfirm("");
		}, setBusy);
	};

	return (
		<Section
			title="Change master password"
			desc="Re-encrypts all stored keys under a new password."
		>
			<form onSubmit={submit} className="space-y-2">
				<PasswordInput
					id="reset-old"
					value={oldPw}
					onChange={setOldPw}
					placeholder="Current password"
				/>
				<PasswordInput
					id="reset-new"
					value={newPw}
					onChange={setNewPw}
					placeholder="New password (min 8 chars)"
				/>
				<PasswordInput
					id="reset-confirm"
					value={confirm}
					onChange={setConfirm}
					placeholder="Confirm new password"
				/>
				<PrimaryButton disabled={busy || !oldPw || !newPw} icon={KeyRound}>
					Change password
				</PrimaryButton>
			</form>
		</Section>
	);
}

function DisableSection({
	onDisable,
}: { onDisable: (pw: string) => Promise<void> }) {
	const [pw, setPw] = useState("");
	const [busy, setBusy] = useState(false);

	const submit = (e: FormEvent) => {
		e.preventDefault();
		run(async () => {
			await onDisable(pw);
			setPw("");
		}, setBusy);
	};

	return (
		<Section
			title="Disable encryption"
			desc="Decrypts your keys back to plaintext storage. Confirm with your current password."
		>
			<form onSubmit={submit} className="flex gap-2">
				<PasswordInput
					id="disable-pw"
					value={pw}
					onChange={setPw}
					placeholder="Master password"
				/>
				<button
					type="submit"
					disabled={busy || !pw}
					className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
				>
					Disable
				</button>
			</form>
		</Section>
	);
}

function DangerSection({ onClear }: { onClear: () => Promise<void> }) {
	const [busy, setBusy] = useState(false);
	const handle = async () => {
		if (
			!(await confirm.ask(
				"Clear All Keys",
				"Clear all stored API keys and encryption metadata? This cannot be undone. Use this only if you've forgotten your master password.",
				true,
			))
		)
			return;
		run(onClear, setBusy);
	};
	return (
		<Section
			title="Forgot password"
			desc="If you've lost your master password, the only way forward is to clear all stored keys and re-enter them."
		>
			<button
				type="button"
				disabled={busy}
				onClick={handle}
				className="rounded-lg border border-danger-border px-3 py-2 text-sm text-danger hover:bg-danger-bg disabled:opacity-40"
			>
				Clear all keys
			</button>
		</Section>
	);
}
