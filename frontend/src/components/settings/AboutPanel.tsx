import { Bug, ChevronRight, Code2, Cpu, PackageOpen } from "lucide-react";
import { useEffect, useState } from "react";
import appIcon from "../../../src-tauri/icons/128x128.png";
import {
	type AppBuildInfo,
	browserBuildInfo,
	getAppBuildInfo,
} from "../../services/appInfo";
import { confirm } from "../../stores/confirmStore";
import { useSettingsStore } from "../../stores/settingsStore";
import OpenSourceComponentsDialog from "./OpenSourceComponentsDialog";
import { THIRD_PARTY_COMPONENTS } from "./thirdPartyComponents";

const PLATFORM_NAMES: Record<string, string> = {
	linux: "Linux",
	macos: "macOS",
	web: "Web",
	windows: "Windows",
};

function platformLabel(info: AppBuildInfo): string {
	const platform = PLATFORM_NAMES[info.target_os] ?? info.target_os;
	return `${platform} / ${info.target_arch}`;
}

export default function AboutPanel() {
	const [info, setInfo] = useState<AppBuildInfo>(() => browserBuildInfo());
	const [componentsOpen, setComponentsOpen] = useState(false);
	const devMode = useSettingsStore((state) => state.devMode);
	const setDevMode = useSettingsStore((state) => state.setDevMode);

	useEffect(() => {
		let disposed = false;
		void getAppBuildInfo().then((buildInfo) => {
			if (!disposed) setInfo(buildInfo);
		});
		return () => {
			disposed = true;
		};
	}, []);

	const toggleDeveloperMode = async () => {
		if (devMode) {
			setDevMode(false);
			return;
		}

		const accepted = await confirm.ask(
			"Enable developer diagnostics?",
			"Developer mode exposes diagnostic controls and may retain sensitive local activity in logs. API keys and authentication headers remain redacted. Only enable it while actively diagnosing a problem.",
		);
		if (accepted) setDevMode(true);
	};

	return (
		<div className="mx-auto max-w-4xl space-y-8">
			<section className="flex items-center gap-4 border-b border-border pb-6">
				<img src={appIcon} alt="EncoreHub" className="h-14 w-14 rounded-md" />
				<div className="min-w-0">
					<h3 className="text-xl font-semibold text-text-primary">EncoreHub</h3>
					<p className="mt-1 text-sm text-text-secondary">
						Multi-provider AI desktop client
					</p>
					<p className="mt-1 font-mono text-xs text-text-muted">
						Version {info.version}
					</p>
				</div>
			</section>

			<section aria-labelledby="build-information-heading">
				<div className="mb-3 flex items-center gap-2">
					<Cpu className="h-4 w-4 text-text-muted" />
					<h3
						id="build-information-heading"
						className="text-sm font-semibold text-text-primary"
					>
						Build information
					</h3>
				</div>
				<dl
					aria-live="polite"
					className="grid grid-cols-2 border-y border-border text-sm max-[760px]:grid-cols-1"
				>
					<div className="flex min-h-12 items-center justify-between gap-4 border-b border-border px-1 py-3 sm:border-r sm:pr-5 max-[760px]:border-r-0">
						<dt className="text-text-muted">Version</dt>
						<dd className="font-mono text-xs text-text-primary">
							{info.version}
						</dd>
					</div>
					<div className="flex min-h-12 items-center justify-between gap-4 border-b border-border px-1 py-3 sm:pl-5 max-[760px]:pl-1">
						<dt className="text-text-muted">Target</dt>
						<dd className="text-right text-text-primary">
							{platformLabel(info)}
						</dd>
					</div>
					<div className="flex min-h-12 items-center justify-between gap-4 px-1 py-3 sm:border-r sm:pr-5 max-[760px]:border-b max-[760px]:border-r-0">
						<dt className="text-text-muted">Build mode</dt>
						<dd
							className={`flex items-center gap-2 font-medium ${
								info.debug_build ? "text-warning" : "text-success"
							}`}
						>
							<span
								aria-hidden="true"
								className={`h-2 w-2 rounded-full ${
									info.debug_build ? "bg-warning" : "bg-success"
								}`}
							/>
							{info.debug_build ? "Debug" : "Release"}
						</dd>
					</div>
					<div className="flex min-h-12 items-center justify-between gap-4 px-1 py-3 sm:pl-5 max-[760px]:pl-1">
						<dt className="text-text-muted">Developer tools</dt>
						<dd className={devMode ? "text-success" : "text-text-secondary"}>
							{devMode ? "Enabled" : "Disabled"}
						</dd>
					</div>
				</dl>
			</section>

			<section aria-labelledby="developer-access-heading">
				<div className="mb-3 flex items-center gap-2">
					<Code2 className="h-4 w-4 text-text-muted" />
					<h3
						id="developer-access-heading"
						className="text-sm font-semibold text-text-primary"
					>
						Developer access
					</h3>
				</div>
				<div className="flex min-h-16 items-center gap-4 border-y border-border py-3">
					<Bug className="h-5 w-5 shrink-0 text-text-muted" />
					<div className="min-w-0 flex-1">
						<p className="text-sm font-medium text-text-primary">
							Developer tools
						</p>
						<p className="mt-0.5 text-xs text-text-muted">
							Show service diagnostics, log controls, and the live log viewer.
						</p>
					</div>
					<button
						type="button"
						role="switch"
						aria-checked={devMode}
						aria-label="Developer tools"
						onClick={() => void toggleDeveloperMode()}
						className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
							devMode ? "bg-accent" : "bg-surface-hover"
						}`}
					>
						<span
							aria-hidden="true"
							className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
								devMode ? "translate-x-5" : "translate-x-1"
							}`}
						/>
					</button>
				</div>
			</section>

			<section aria-labelledby="open-source-heading">
				<h3
					id="open-source-heading"
					className="mb-3 text-sm font-semibold text-text-primary"
				>
					Legal
				</h3>
				<button
					type="button"
					onClick={() => setComponentsOpen(true)}
					aria-haspopup="dialog"
					className="group flex min-h-16 w-full items-center gap-4 border-y border-border py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
				>
					<PackageOpen className="h-5 w-5 shrink-0 text-text-muted" />
					<div className="min-w-0 flex-1">
						<p className="text-sm font-medium text-text-primary">
							Open-source components
						</p>
						<p className="mt-0.5 text-xs leading-5 text-text-muted">
							Review {THIRD_PARTY_COMPONENTS.length} bundled components,
							versions, and license identifiers.
						</p>
					</div>
					<span className="flex shrink-0 items-center gap-1 text-xs text-text-secondary transition-colors group-hover:text-text-primary">
						View
						<ChevronRight className="h-4 w-4" />
					</span>
				</button>
			</section>

			<OpenSourceComponentsDialog
				open={componentsOpen}
				onClose={() => setComponentsOpen(false)}
			/>
		</div>
	);
}
