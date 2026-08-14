/**
 * Renders the desktop startup surface while local services become available.
 *
 * The screen deliberately mirrors the steady-state shell instead of introducing
 * a separate splash-screen visual language. Service details remain abstracted
 * behind user-facing phases because the gateway is the frontend's only network
 * boundary and owns communication with the engine.
 */
import { MessageSquare } from "lucide-react";

/** Readiness signals exposed by the top-level startup coordinator. */
type StartupScreenProps = {
	/** Whether the desktop shell has resolved its local service ports. */
	portsReady: boolean;
	/** Whether the embedded intelligence engine is accepting work. */
	engineReady: boolean;
	/** Whether the gateway can open the application workspace. */
	gatewayReady: boolean;
};

/**
 * Maps internal readiness signals to one stable, user-facing phase.
 *
 * The ordering is intentional: port negotiation must finish before services can
 * start, and both local services must be ready before the workspace opens.
 */
function statusMessage({
	portsReady,
	engineReady,
	gatewayReady,
}: StartupScreenProps) {
	if (!portsReady) return "Preparing desktop runtime";
	if (!engineReady) return "Starting local services";
	if (!gatewayReady) return "Connecting workspace";
	return "Opening workspace";
}

/**
 * Presents startup progress using the same shell, tokens, and empty-state motif
 * as the main chat workspace. The status output is live for assistive technology;
 * the animated line is decorative and excluded from the accessibility tree.
 */
export default function StartupScreen(props: StartupScreenProps) {
	const status = statusMessage(props);

	return (
		<main className="startup-screen">
			<div className="startup-titlebar" aria-hidden="true">
				<div className="startup-app-identity">
					<MessageSquare />
					<span>EncoreHub</span>
				</div>
			</div>

			<section className="startup-workspace" aria-labelledby="startup-title">
				<div className="startup-content">
					<div className="startup-brand-mark" aria-hidden="true">
						<MessageSquare />
					</div>
					<h1 id="startup-title">EncoreHub</h1>
					<output
						className="startup-status"
						aria-label="Startup status"
						aria-live="polite"
					>
						{status}
					</output>
					<div className="startup-progress" aria-hidden="true">
						<span aria-hidden="true" />
					</div>
				</div>
			</section>
		</main>
	);
}
