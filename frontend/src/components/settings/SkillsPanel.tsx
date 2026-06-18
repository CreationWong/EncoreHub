import { Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { type Skill, skillsApi } from "../../services/skills";
import { toast } from "../../stores/toastStore";

export default function SkillsPanel() {
	const [skills, setSkills] = useState<Skill[]>([]);
	const [loading, setLoading] = useState(false);

	const load = async () => {
		setLoading(true);
		try {
			const r = await skillsApi.list();
			setSkills(r.skills);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "load failed");
		} finally {
			setLoading(false);
		}
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: load on mount only
	useEffect(() => {
		load();
	}, []);

	const toggle = async (id: string, next: boolean) => {
		// optimistic
		setSkills((s) => s.map((x) => (x.id === id ? { ...x, enabled: next } : x)));
		try {
			await skillsApi.toggle(id, next);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "toggle failed");
			// rollback
			setSkills((s) =>
				s.map((x) => (x.id === id ? { ...x, enabled: !next } : x)),
			);
		}
	};

	if (loading && skills.length === 0) {
		return (
			<div className="flex items-center justify-center py-10 text-text-muted">
				<Loader2 className="h-4 w-4 animate-spin" />
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<p className="text-xs text-text-muted">
				Skills are loaded from the engine's <code>skills/</code> directory.
				Toggle to enable/disable for the chat session.
			</p>

			{skills.length === 0 && !loading && (
				<p className="py-10 text-center text-sm text-text-muted">
					No skills installed.
				</p>
			)}

			<ul className="space-y-2">
				{skills.map((s) => (
					<li
						key={s.id}
						className="rounded-lg border border-border bg-surface-alt/40 p-3"
					>
						<div className="flex items-start justify-between gap-3">
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-2">
									<span className="truncate text-sm font-medium text-text-primary">
										{s.name}
									</span>
									{s.builtin && (
										<span className="inline-flex items-center gap-0.5 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
											<ShieldCheck className="h-3 w-3" />
											builtin
										</span>
									)}
									<span className="text-[10px] text-text-muted">
										v{s.version}
									</span>
								</div>
								{s.description && (
									<p className="mt-1 text-xs text-text-muted">
										{s.description}
									</p>
								)}
								<div className="mt-1.5 flex flex-wrap gap-1 text-[10px] text-text-muted">
									{s.triggers.slice(0, 4).map((t) => (
										<span
											key={t}
											className="rounded bg-surface-hover px-1.5 py-0.5"
										>
											{t}
										</span>
									))}
									<span>· {s.tool_count} tools</span>
								</div>
							</div>
							<button
								type="button"
								role="switch"
								aria-checked={s.enabled}
								onClick={() => toggle(s.id, !s.enabled)}
								className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
									s.enabled ? "bg-accent" : "bg-surface-hover"
								}`}
							>
								<span
									className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
										s.enabled ? "translate-x-5" : "translate-x-1"
									}`}
								/>
							</button>
						</div>
					</li>
				))}
			</ul>
		</div>
	);
}
