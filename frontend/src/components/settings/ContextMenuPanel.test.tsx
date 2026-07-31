import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_GLOBAL_CONTEXT_MENU_ITEMS,
	useSettingsStore,
} from "../../stores/settingsStore";
import ContextMenuPanel from "./ContextMenuPanel";

const elementFromPoint = vi.fn<(x: number, y: number) => Element | null>();

describe("ContextMenuPanel", () => {
	beforeEach(() => {
		localStorage.clear();
		elementFromPoint.mockReset();
		Object.defineProperty(document, "elementFromPoint", {
			configurable: true,
			value: elementFromPoint,
		});
		useSettingsStore.setState({
			globalContextMenuItems: DEFAULT_GLOBAL_CONTEXT_MENU_ITEMS.map((item) => ({
				...item,
			})),
		});
	});

	afterEach(cleanup);

	it("reorders items with pointer dragging from the handle", () => {
		render(<ContextMenuPanel />);
		const target = screen.getByRole("listitem", { name: "New conversation" });
		elementFromPoint.mockReturnValue(target);

		fireEvent.pointerDown(
			screen.getByRole("button", { name: "Drag Settings" }),
			{ pointerId: 1 },
		);
		fireEvent.pointerMove(window, { clientX: 20, clientY: 20, pointerId: 1 });
		fireEvent.pointerUp(window, { pointerId: 1 });

		expect(
			useSettingsStore.getState().globalContextMenuItems.map((item) => item.id),
		).toEqual(["settings", "new-chat"]);
	});

	it("can remove every global menu item", () => {
		render(<ContextMenuPanel />);

		fireEvent.click(
			screen.getByRole("checkbox", { name: "Show New conversation" }),
		);
		fireEvent.click(screen.getByRole("checkbox", { name: "Show Settings" }));

		expect(
			useSettingsStore
				.getState()
				.globalContextMenuItems.every((item) => !item.visible),
		).toBe(true);
	});
});
