/**
 * Verifies the startup surface's user-facing phase and accessibility contract.
 *
 * Rendering tests intentionally assert stable semantics rather than decorative
 * markup so visual refinements cannot silently weaken status announcements.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import StartupScreen from "./StartupScreen";

describe("StartupScreen", () => {
	afterEach(cleanup);

	// A partially ready runtime must expose the service-start phase in both the
	// visible copy and the labelled live output used by assistive technology.
	it("shows the current startup stage", () => {
		render(
			<StartupScreen
				portsReady={true}
				engineReady={false}
				gatewayReady={false}
			/>,
		);

		expect(screen.getByText("Starting local services")).toBeDefined();
		expect(screen.getByLabelText("Startup status").textContent).toBe(
			"Starting local services",
		);
	});

	// Once every dependency is ready, the final phase should describe the imminent
	// workspace transition without exposing internal implementation details.
	it("announces the workspace transition after services are ready", () => {
		render(
			<StartupScreen
				portsReady={true}
				engineReady={true}
				gatewayReady={true}
			/>,
		);

		expect(screen.getByText("Opening workspace")).toBeDefined();
		expect(screen.getByLabelText("Startup status")).toBeDefined();
	});
});
