import {
	GitBranch,
	GitCommitHorizontal,
	History,
	Loader2,
	RotateCcw,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
	type CharacterHistory as CharacterHistoryData,
	type CharacterHistoryListResponse,
	type CharacterProfile,
	type CharacterVersion,
	listCharacterHistories,
} from "../../services/characters";
import { useCharacterStore } from "../../stores/characterStore";
import { confirm } from "../../stores/confirmStore";
import { toast } from "../../stores/toastStore";

interface CharacterHistoryProps {
	selectedCharacterId: string | null;
	onProfileChange: (profile: CharacterProfile) => void;
	loadHistories?: () => Promise<CharacterHistoryListResponse>;
}

type PendingAction =
	| { type: "branch"; version: CharacterVersion }
	| { type: "commit" }
	| null;

function formattedDate(value: string): string {
	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(value));
}

export default function CharacterHistory({
	selectedCharacterId,
	onProfileChange,
	loadHistories = listCharacterHistories,
}: CharacterHistoryProps) {
	const commitVersion = useCharacterStore((state) => state.commitVersion);
	const createBranch = useCharacterStore((state) => state.createBranch);
	const restoreVersion = useCharacterStore((state) => state.restoreVersion);
	const [histories, setHistories] = useState<CharacterHistoryData[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState<PendingAction>(null);
	const [value, setValue] = useState("");
	const [submitting, setSubmitting] = useState(false);

	const refresh = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			setHistories((await loadHistories()).histories);
		} catch (caught) {
			setError(
				caught instanceof Error ? caught.message : "Failed to load history",
			);
		} finally {
			setLoading(false);
		}
	}, [loadHistories]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	function begin(action: PendingAction) {
		setPending(action);
		setValue("");
		setError(null);
	}

	async function submitPending() {
		if (!pending || !selectedCharacterId || !value.trim() || submitting) return;
		setSubmitting(true);
		try {
			const profile =
				pending.type === "commit"
					? await commitVersion(selectedCharacterId, value.trim())
					: await createBranch(
							selectedCharacterId,
							value.trim(),
							pending.version.version,
						);
			onProfileChange(profile);
			toast.success(
				pending.type === "commit"
					? `Version ${profile.version} created`
					: `Branch ${profile.active_branch} created`,
			);
			setPending(null);
			setValue("");
			await refresh();
		} catch (caught) {
			setError(
				caught instanceof Error ? caught.message : "History action failed",
			);
		} finally {
			setSubmitting(false);
		}
	}

	async function restore(
		history: CharacterHistoryData,
		version: CharacterVersion,
	) {
		const accepted = await confirm.ask(
			"Restore this version?",
			`Load ${history.character.name} Version ${version.version} into the ${history.character.active_branch} working copy? The history tree will not be changed.`,
		);
		if (!accepted) return;
		setSubmitting(true);
		try {
			const profile = await restoreVersion(
				history.character.id,
				version.version,
			);
			onProfileChange(profile);
			toast.success(`Version ${version.version} restored to working copy`);
			await refresh();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Restore failed");
		} finally {
			setSubmitting(false);
		}
	}

	const selectedHistory = histories.find(
		(history) => history.character.id === selectedCharacterId,
	);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<header className="flex min-h-14 shrink-0 flex-wrap items-center gap-3 border-b border-border px-5 py-2">
				<div className="min-w-0 flex-1">
					<p className="text-sm font-semibold">Global version history</p>
					<p className="text-[11px] text-text-muted">
						{selectedHistory
							? `${selectedHistory.character.active_branch} · Version ${selectedHistory.character.version} working copy`
							: "Select a character to create a version"}
					</p>
				</div>
				<button
					type="button"
					onClick={() => begin({ type: "commit" })}
					disabled={!selectedCharacterId || submitting}
					className="flex h-8 items-center gap-2 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
				>
					<GitCommitHorizontal className="h-3.5 w-3.5" />
					Create version
				</button>
			</header>

			{pending && (
				<div className="flex items-end gap-2 border-b border-border bg-app-canvas px-5 py-3">
					<label className="min-w-0 flex-1">
						<span className="mb-1 block text-[11px] font-medium text-text-secondary">
							{pending.type === "commit"
								? "Version message"
								: `Branch from Version ${pending.version.version}`}
						</span>
						<input
							autoComplete="off"
							value={value}
							onChange={(event) => setValue(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") void submitPending();
							}}
							maxLength={pending.type === "commit" ? 200 : 64}
							placeholder={
								pending.type === "commit"
									? "Describe this version"
									: "branch-name"
							}
							className="h-8 w-full rounded-md border border-border bg-control px-2.5 text-xs text-text-primary outline-none focus:border-accent"
						/>
					</label>
					<button
						type="button"
						onClick={() => setPending(null)}
						className="h-8 rounded-md px-3 text-xs text-text-secondary hover:bg-control"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={() => void submitPending()}
						disabled={!value.trim() || submitting}
						className="h-8 rounded-md border border-border px-3 text-xs font-medium hover:bg-control disabled:opacity-50"
					>
						{submitting
							? "Working..."
							: pending.type === "commit"
								? "Create"
								: "Create branch"}
					</button>
				</div>
			)}

			{error && (
				<div className="border-b border-danger-border bg-danger-bg px-5 py-2 text-xs text-danger">
					{error}
				</div>
			)}

			<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
				{loading && (
					<output
						aria-label="Loading character history"
						className="flex h-40 items-center justify-center"
					>
						<Loader2 className="h-4 w-4 animate-spin text-text-muted" />
					</output>
				)}
				{!loading && histories.length === 0 && (
					<div className="flex h-40 flex-col items-center justify-center text-text-muted">
						<History className="mb-2 h-5 w-5" />
						<p className="text-xs">No character history</p>
					</div>
				)}
				<div className="space-y-6">
					{histories.map((history) => (
						<section
							key={history.character.id}
							aria-label={`${history.character.name} history`}
						>
							<div className="mb-2 flex items-center gap-2 border-b border-border pb-2">
								<h3 className="min-w-0 flex-1 truncate text-xs font-semibold">
									{history.character.name}
								</h3>
								<span className="text-[10px] text-text-muted">
									{history.branches.length}{" "}
									{history.branches.length === 1 ? "branch" : "branches"}
								</span>
							</div>
							<div className="relative ml-2 border-l border-border pl-5">
								{history.versions.map((version) => {
									const isWorking =
										history.character.version === version.version;
									const heads = history.branches.filter(
										(branch) => branch.head_version === version.version,
									);
									return (
										<div
											key={version.version}
											className="relative flex min-h-16 gap-3 py-2"
										>
											<span
												className={`absolute -left-[25px] top-4 h-2.5 w-2.5 rounded-full border-2 ${isWorking ? "border-accent bg-accent" : "border-border bg-workspace"}`}
											/>
											<div className="w-16 shrink-0 pt-0.5 text-[11px] font-medium tabular-nums">
												v{version.version}
											</div>
											<div className="min-w-0 flex-1">
												<div className="flex flex-wrap items-center gap-1.5">
													<span className="text-xs font-medium">
														{version.message}
													</span>
													{heads.map((branch) => (
														<span
															key={branch.name}
															className="inline-flex items-center gap-1 rounded border border-border bg-control px-1.5 py-0.5 text-[10px] text-text-secondary"
														>
															<GitBranch className="h-2.5 w-2.5" />
															{branch.name}
														</span>
													))}
													{isWorking && (
														<span className="text-[10px] font-medium text-accent">
															working copy
														</span>
													)}
												</div>
												<p className="mt-1 text-[10px] text-text-muted">
													{version.branch_name} ·{" "}
													{formattedDate(version.created_at)}
													{version.parent_version
														? ` · parent v${version.parent_version}`
														: ""}
												</p>
											</div>
											<div className="flex shrink-0 items-start gap-1">
												<button
													type="button"
													onClick={() => begin({ type: "branch", version })}
													disabled={
														history.character.id !== selectedCharacterId ||
														submitting
													}
													title="Create branch from this version"
													aria-label={`Create branch from version ${version.version}`}
													className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-control hover:text-text-primary disabled:opacity-30"
												>
													<GitBranch className="h-3.5 w-3.5" />
												</button>
												<button
													type="button"
													onClick={() => void restore(history, version)}
													disabled={
														history.character.id !== selectedCharacterId ||
														submitting ||
														isWorking
													}
													title="Restore to working copy"
													aria-label={`Restore version ${version.version}`}
													className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-control hover:text-text-primary disabled:opacity-30"
												>
													<RotateCcw className="h-3.5 w-3.5" />
												</button>
											</div>
										</div>
									);
								})}
							</div>
						</section>
					))}
				</div>
			</div>
		</div>
	);
}
