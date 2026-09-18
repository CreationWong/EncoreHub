/** Renders application build, legal, and developer-access information. */
import { Bug, ChevronRight, Code2, Cpu, PackageOpen } from "lucide-react";
import { Suspense, lazy, useEffect, useState } from "react";
import appIcon from "../../../src-tauri/icons/128x128.png";
import { type MessageKey, t, useT } from "../../i18n";
import {
	type AppBuildInfo,
	browserBuildInfo,
	formatDisplayVersion,
	getAppBuildInfo,
} from "../../services/appInfo";
import { confirm } from "../../stores/confirmStore";
import { useSettingsStore } from "../../stores/settingsStore";
import {
	OSS_COMPONENT_COUNT,
	OSS_RELEASE_TARGET,
} from "./thirdPartySummary.generated";

const OpenSourceComponentsDialog = lazy(
	() => import("./OpenSourceComponentsDialog"),
);

/** Catalog keys for known desktop/web targets; unknown ids stay as raw OS names. */
const PLATFORM_KEYS: Record<string, MessageKey> = {
	linux: "about.linux",
	macos: "about.macos",
	web: "about.web",
	windows: "about.windows",
};

/** Localized platform / architecture line for the build-information table. */
function platformLabel(
	info: AppBuildInfo,
	translate: (key: MessageKey) => string,
): string {
	const key = PLATFORM_KEYS[info.target_os];
	const platform = key ? translate(key) : info.target_os;
	return `${platform} / ${info.target_arch}`;
}

/** About settings: version, target, developer access, and OSS credits. */
export default function AboutPanel() {
	const translate = useT();
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
			t("about.enableDeveloper"),
			t("about.enableDeveloperMessage"),
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
						{translate("about.tagline")}
					</p>
					<p className="mt-1 font-mono text-xs text-text-muted">
						{formatDisplayVersion(
							info.version,
							info.build_id,
							info.debug_build || devMode,
						)}
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
						{translate("about.buildInformation")}
					</h3>
				</div>
				<dl
					aria-live="polite"
					className="grid grid-cols-2 border-y border-border text-sm max-[760px]:grid-cols-1"
				>
					<div className="flex min-h-12 items-center justify-between gap-4 border-b border-border px-1 py-3 sm:border-r sm:pr-5 max-[760px]:border-r-0">
						<dt className="text-text-muted">{translate("common.version")}</dt>
						<dd className="font-mono text-xs text-text-primary">
							{formatDisplayVersion(
								info.version,
								info.build_id,
								info.debug_build || devMode,
							)}
						</dd>
					</div>
					<div className="flex min-h-12 items-center justify-between gap-4 border-b border-border px-1 py-3 sm:pl-5 max-[760px]:pl-1">
						<dt className="text-text-muted">{translate("about.target")}</dt>
						<dd className="text-right text-text-primary">
							{platformLabel(info, translate)}
						</dd>
					</div>
					<div className="flex min-h-12 items-center justify-between gap-4 px-1 py-3 sm:border-r sm:pr-5 max-[760px]:border-b max-[760px]:border-r-0">
						<dt className="text-text-muted">{translate("about.buildMode")}</dt>
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
							{info.debug_build
								? translate("about.debug")
								: translate("about.release")}
						</dd>
					</div>
					<div className="flex min-h-12 items-center justify-between gap-4 px-1 py-3 sm:pl-5 max-[760px]:pl-1">
						<dt className="text-text-muted">
							{translate("about.developerTools")}
						</dt>
						<dd className={devMode ? "text-success" : "text-text-secondary"}>
							{devMode
								? translate("common.enabled")
								: translate("common.disabled")}
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
						{translate("about.developerAccess")}
					</h3>
				</div>
				<div className="flex min-h-16 items-center gap-4 border-y border-border py-3">
					<Bug className="h-5 w-5 shrink-0 text-text-muted" />
					<div className="min-w-0 flex-1">
						<p className="text-sm font-medium text-text-primary">
							{translate("about.developerTools")}
						</p>
						<p className="mt-0.5 text-xs text-text-muted">
							{translate("about.developerToolsHelp")}
						</p>
					</div>
					<button
						type="button"
						role="switch"
						aria-checked={devMode}
						aria-label={translate("about.developerTools")}
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
					{translate("common.legal")}
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
							{translate("about.openSource")}
						</p>
						<p className="mt-0.5 text-xs leading-5 text-text-muted">
							{translate("about.openSourceCount", {
								count: OSS_COMPONENT_COUNT,
								target: OSS_RELEASE_TARGET,
							})}
						</p>
					</div>
					<span className="flex shrink-0 items-center gap-1 text-xs text-text-secondary transition-colors group-hover:text-text-primary">
						{translate("common.view")}
						<ChevronRight className="h-4 w-4" />
					</span>
				</button>
			</section>

			{componentsOpen ? (
				<Suspense fallback={null}>
					<OpenSourceComponentsDialog
						open
						onClose={() => setComponentsOpen(false)}
					/>
				</Suspense>
			) : null}
		</div>
	);
}
