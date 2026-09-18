// Security settings: master-password encryption for stored provider API keys.

import {
	KeyRound,
	Lock,
	LockOpen,
	ShieldAlert,
	ShieldCheck,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { t, useT } from "../../i18n";
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
	const translate = useT();
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
						toast.success(translate("security.encryptionEnabled"));
					}}
				/>
			)}

			{encrypted && !unlocked && (
				<UnlockSection
					onUnlock={async (pw) => {
						await unlock(pw);
						toast.success(t("toast.unlockedSession"));
					}}
				/>
			)}

			{encrypted && unlocked && (
				<>
					<LockSection
						onLock={async () => {
							await lock();
							toast.info(t("toast.databaseLocked"));
						}}
					/>
					<ResetSection
						onReset={async (oldPw, newPw) => {
							await resetPassword(oldPw, newPw);
							toast.success(t("toast.passwordChanged"));
						}}
					/>
					<DisableSection
						onDisable={async (pw) => {
							await disable(pw);
							toast.info(t("toast.encryptionDisabled"));
						}}
					/>
				</>
			)}

			{encrypted && (
				<DangerSection
					onClear={async () => {
						await clear();
						toast.info(t("toast.keysCleared"));
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
	const translate = useT();
	if (!loaded) {
		return (
			<p className="text-xs text-text-muted">
				{translate("security.checking")}
			</p>
		);
	}
	const Icon = !encrypted ? ShieldAlert : unlocked ? ShieldCheck : Lock;
	const tone = !encrypted
		? "text-warning"
		: unlocked
			? "text-success"
			: "text-text-secondary";
	const label = !encrypted
		? translate("security.notEncrypted")
		: unlocked
			? translate("security.unlockedSession")
			: translate("security.locked");
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
			autoComplete="off"
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

/** Run a vault mutation, surface failures, and always clear the busy flag. */
async function run(action: () => Promise<void>, setBusy: (b: boolean) => void) {
	setBusy(true);
	try {
		await action();
	} catch (e) {
		toast.error(e instanceof Error ? e.message : t("toast.operationFailed"));
	} finally {
		setBusy(false);
	}
}

function EnableSection({
	onEnable,
}: { onEnable: (pw: string) => Promise<void> }) {
	const translate = useT();
	const [pw, setPw] = useState("");
	const [confirmPw, setConfirmPw] = useState("");
	const [busy, setBusy] = useState(false);

	const submit = (e: FormEvent) => {
		e.preventDefault();
		if (pw !== confirmPw) {
			toast.error(t("toast.passwordsMismatch"));
			return;
		}
		if (pw.length < 8) {
			toast.error(t("toast.passwordTooShort"));
			return;
		}
		run(async () => {
			await onEnable(pw);
			setPw("");
			setConfirmPw("");
		}, setBusy);
	};

	return (
		<Section
			title={translate("security.enableEncryption")}
			desc={translate("security.enableHelp")}
		>
			<form onSubmit={submit} className="space-y-2">
				<PasswordInput
					id="enc-pw"
					value={pw}
					onChange={setPw}
					placeholder={translate("security.masterPasswordMin")}
				/>
				<PasswordInput
					id="enc-pw-confirm"
					value={confirmPw}
					onChange={setConfirmPw}
					placeholder={translate("security.confirmPassword")}
				/>
				<p className="flex items-start gap-1.5 text-xs text-warning">
					<ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
					{translate("security.forgetWarning")}
				</p>
				<PrimaryButton disabled={busy || !pw} icon={Lock}>
					{translate("security.enableEncryption")}
				</PrimaryButton>
			</form>
		</Section>
	);
}

function UnlockSection({
	onUnlock,
}: { onUnlock: (pw: string) => Promise<void> }) {
	const translate = useT();
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
			title={translate("security.unlock")}
			desc={translate("security.unlockHelp")}
		>
			<form onSubmit={submit} className="space-y-2">
				<PasswordInput
					id="unlock-pw"
					value={pw}
					onChange={setPw}
					placeholder={translate("security.masterPassword")}
					autoFocus
				/>
				<PrimaryButton disabled={busy || !pw} icon={LockOpen}>
					{translate("security.unlock")}
				</PrimaryButton>
			</form>
		</Section>
	);
}

function LockSection({ onLock }: { onLock: () => Promise<void> }) {
	const translate = useT();
	const [busy, setBusy] = useState(false);
	return (
		<Section
			title={translate("security.lock")}
			desc={translate("security.lockHelp")}
		>
			<button
				type="button"
				disabled={busy}
				onClick={() => run(onLock, setBusy)}
				className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
			>
				<Lock className="h-4 w-4" />
				{translate("security.lockNow")}
			</button>
		</Section>
	);
}

function ResetSection({
	onReset,
}: {
	onReset: (oldPw: string, newPw: string) => Promise<void>;
}) {
	const translate = useT();
	const [oldPw, setOldPw] = useState("");
	const [newPw, setNewPw] = useState("");
	const [confirmPw, setConfirmPw] = useState("");
	const [busy, setBusy] = useState(false);

	const submit = (e: FormEvent) => {
		e.preventDefault();
		if (newPw !== confirmPw) {
			toast.error(t("toast.newPasswordsMismatch"));
			return;
		}
		if (newPw.length < 8) {
			toast.error(t("toast.passwordTooShort"));
			return;
		}
		run(async () => {
			await onReset(oldPw, newPw);
			setOldPw("");
			setNewPw("");
			setConfirmPw("");
		}, setBusy);
	};

	return (
		<Section
			title={translate("security.changePassword")}
			desc={translate("security.changeHelp")}
		>
			<form onSubmit={submit} className="space-y-2">
				<PasswordInput
					id="reset-old"
					value={oldPw}
					onChange={setOldPw}
					placeholder={translate("security.currentPassword")}
				/>
				<PasswordInput
					id="reset-new"
					value={newPw}
					onChange={setNewPw}
					placeholder={translate("security.newPasswordMin")}
				/>
				<PasswordInput
					id="reset-confirm"
					value={confirmPw}
					onChange={setConfirmPw}
					placeholder={translate("security.confirmNewPassword")}
				/>
				<PrimaryButton disabled={busy || !oldPw || !newPw} icon={KeyRound}>
					{translate("security.changePassword")}
				</PrimaryButton>
			</form>
		</Section>
	);
}

function DisableSection({
	onDisable,
}: { onDisable: (pw: string) => Promise<void> }) {
	const translate = useT();
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
			title={translate("security.disableEncryption")}
			desc={translate("security.disableHelp")}
		>
			<form onSubmit={submit} className="flex gap-2">
				<PasswordInput
					id="disable-pw"
					value={pw}
					onChange={setPw}
					placeholder={translate("security.masterPassword")}
				/>
				<button
					type="submit"
					disabled={busy || !pw}
					className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
				>
					{translate("security.disable")}
				</button>
			</form>
		</Section>
	);
}

function DangerSection({ onClear }: { onClear: () => Promise<void> }) {
	const translate = useT();
	const [busy, setBusy] = useState(false);
	const handle = async () => {
		if (
			!(await confirm.ask(
				t("security.clearAllKeys"),
				t("security.clearAllKeysConfirm"),
				true,
			))
		)
			return;
		run(onClear, setBusy);
	};
	return (
		<Section
			title={translate("security.forgotPassword")}
			desc={translate("security.forgotHelp")}
		>
			<button
				type="button"
				disabled={busy}
				onClick={handle}
				className="rounded-lg border border-danger-border px-3 py-2 text-sm text-danger hover:bg-danger-bg disabled:opacity-40"
			>
				{translate("security.clearAllKeysButton")}
			</button>
		</Section>
	);
}
