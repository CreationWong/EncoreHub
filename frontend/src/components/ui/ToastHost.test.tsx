import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useToastStore } from "../../stores/toastStore";
import ToastHost from "./ToastHost";

beforeEach(() => {
	useToastStore.setState({ toasts: [] });
});

afterEach(() => {
	cleanup();
	useToastStore.setState({ toasts: [] });
});

describe("ToastHost", () => {
	it("stacks opaque notifications in the upper-right content area", () => {
		useToastStore.setState({
			toasts: [
				{ id: 1, kind: "success", message: "Provider saved" },
				{ id: 2, kind: "error", message: "Unable to fetch models" },
			],
		});

		render(<ToastHost />);

		const region = screen.getByRole("region", { name: "Notifications" });
		expect(region.classList.contains("top-[4.75rem]")).toBe(true);
		expect(region.className).not.toContain("bottom-");
		expect(screen.getByText("Provider saved")).toBeTruthy();
		expect(screen.getByText("Unable to fetch models")).toBeTruthy();

		for (const notification of region.querySelectorAll("output")) {
			expect(notification.classList.contains("bg-workspace")).toBe(true);
		}
	});

	it("dismisses only the selected notification", () => {
		useToastStore.setState({
			toasts: [
				{ id: 1, kind: "info", message: "First notification" },
				{ id: 2, kind: "warning", message: "Second notification" },
			],
		});
		render(<ToastHost />);

		fireEvent.click(
			screen.getAllByRole("button", { name: "Dismiss notification" })[0],
		);

		expect(screen.queryByText("First notification")).toBeNull();
		expect(screen.getByText("Second notification")).toBeTruthy();
	});
});
