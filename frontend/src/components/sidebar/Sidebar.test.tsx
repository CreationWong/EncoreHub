import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setSidebarMode = vi.fn();
const setSidebarWidth = vi.fn();

const settingsState = {
	sidebarOpen: true,
	focusMode: false,
	sidebarWidth: 300,
	sidebarMode: "conversations" as "characters" | "conversations",
	setSidebarMode,
	setSidebarWidth,
};

vi.mock("../../stores/settingsStore", () => ({
	useSettingsStore: <T,>(selector: (state: typeof settingsState) => T): T =>
		selector(settingsState),
	SIDEBAR_MIN_WIDTH: 260,
	SIDEBAR_MAX_WIDTH: 380,
}));

vi.mock("./CharacterList", () => ({
	default: () => <div>Character pane</div>,
}));
vi.mock("./ConversationList", () => ({
	default: () => <div>Conversation pane</div>,
}));

import Sidebar from "./Sidebar";

beforeEach(() => {
	setSidebarMode.mockReset();
	setSidebarWidth.mockReset();
	settingsState.sidebarOpen = true;
	settingsState.focusMode = false;
	settingsState.sidebarWidth = 300;
	settingsState.sidebarMode = "conversations";
});

afterEach(cleanup);

describe("Sidebar tabs", () => {
	it("uses accessible Character and Chat tabs with conversations selected", () => {
		render(<Sidebar />);

		expect(screen.getByRole("tab", { name: "Characters" })).toBeDefined();
		const chats = screen.getByRole("tab", { name: "Conversations" });
		expect(chats.getAttribute("aria-selected")).toBe("true");
		expect(screen.getByRole("tabpanel").textContent).toContain(
			"Conversation pane",
		);
	});

	it("switches pane through click and arrow-key navigation", () => {
		render(<Sidebar />);
		const characters = screen.getByRole("tab", { name: "Characters" });
		const chats = screen.getByRole("tab", { name: "Conversations" });

		fireEvent.click(characters);
		expect(setSidebarMode).toHaveBeenCalledWith("characters");
		fireEvent.keyDown(chats, { key: "ArrowLeft" });
		expect(setSidebarMode).toHaveBeenLastCalledWith("characters");
		expect(document.activeElement).toBe(characters);
	});
});

describe("Sidebar sizing", () => {
	it("uses the persisted width and target min/max bounds", () => {
		const { container } = render(<Sidebar />);
		const aside = container.querySelector("aside") as HTMLElement;
		expect(aside.style.width).toBe("300px");
		expect(aside.style.minWidth).toBe("260px");
		expect(aside.style.maxWidth).toBe("380px");
	});

	it("dragging the resize handle updates the sidebar width", () => {
		render(<Sidebar />);
		const handle = screen.getByLabelText("Resize sidebar");
		fireEvent.pointerDown(handle);
		window.dispatchEvent(new MouseEvent("pointermove", { clientX: 320 }));
		expect(setSidebarWidth).toHaveBeenLastCalledWith(320);
	});

	it("renders no icon rail or resize handle when collapsed", () => {
		settingsState.sidebarOpen = false;
		const { container } = render(<Sidebar />);
		expect(container.innerHTML).toBe("");
		expect(screen.queryByLabelText("Resize sidebar")).toBeNull();
	});

	it("hides while focus mode is active", () => {
		settingsState.focusMode = true;
		const { container } = render(<Sidebar />);
		expect(container.innerHTML).toBe("");
	});
});
