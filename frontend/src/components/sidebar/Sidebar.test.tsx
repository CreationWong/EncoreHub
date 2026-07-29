import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setSidebarMode = vi.fn();
const setSidebarWidth = vi.fn();
const toggleSidebar = vi.fn();
const responsive = vi.hoisted(() => ({
	drawer: false,
	constrained: false,
}));

vi.mock("../../hooks/useMediaQuery", () => ({
	useMediaQuery: (query: string) =>
		query.includes("899px") ? responsive.drawer : responsive.constrained,
}));

const settingsState = {
	sidebarOpen: true,
	sidebarWidth: 300,
	sidebarMode: "conversations" as "characters" | "conversations",
	setSidebarMode,
	setSidebarWidth,
	toggleSidebar,
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
	toggleSidebar.mockReset();
	responsive.drawer = false;
	responsive.constrained = false;
	settingsState.sidebarOpen = true;
	settingsState.sidebarWidth = 300;
	settingsState.sidebarMode = "conversations";
});

afterEach(() => {
	cleanup();
	document.documentElement.classList.remove("sidebar-drawer-open");
	document.body.style.overflow = "";
});

describe("Sidebar tabs", () => {
	it("uses accessible Character and Chat tabs with conversations selected", () => {
		render(<Sidebar />);

		expect(screen.getByRole("tab", { name: "Characters" })).toBeDefined();
		const chats = screen.getByRole("tab", { name: "Conversations" });
		expect(chats.getAttribute("aria-selected")).toBe("true");
		expect(chats.className).toContain("focus-visible:bg-control");
		expect(chats.className).toContain("focus-visible:shadow-none");
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
		expect(aside.style.getPropertyValue("--sidebar-width")).toBe("300px");
		expect(aside.style.minWidth).toBe("260px");
		expect(aside.style.maxWidth).toBe("380px");
		expect(aside.dataset.sidebarLayout).toBe("desktop");
	});

	it("dragging the resize handle updates the sidebar width", () => {
		render(<Sidebar />);
		const handle = screen.getByRole("separator", { name: "Resize sidebar" });
		expect(handle.getAttribute("aria-orientation")).toBe("vertical");
		expect(handle.getAttribute("aria-valuenow")).toBe("300");
		expect(handle.className).not.toContain("hover:bg-accent");
		expect(handle.className).toContain("focus-visible:shadow-none");
		expect(handle.className).toContain("focus-visible:after:bg-accent");
		fireEvent.pointerDown(handle);
		window.dispatchEvent(new MouseEvent("pointermove", { clientX: 320 }));
		expect(setSidebarWidth).toHaveBeenLastCalledWith(320);
	});

	it("supports bounded keyboard resizing without a full-height accent state", () => {
		render(<Sidebar />);
		const handle = screen.getByLabelText("Resize sidebar");

		fireEvent.keyDown(handle, { key: "ArrowRight" });
		expect(setSidebarWidth).toHaveBeenLastCalledWith(308);
		fireEvent.keyDown(handle, { key: "Home" });
		expect(setSidebarWidth).toHaveBeenLastCalledWith(260);
		fireEvent.keyDown(handle, { key: "End" });
		expect(setSidebarWidth).toHaveBeenLastCalledWith(380);
	});

	it("renders no icon rail or resize handle when collapsed", () => {
		settingsState.sidebarOpen = false;
		const { container } = render(<Sidebar />);
		expect(container.innerHTML).toBe("");
		expect(screen.queryByLabelText("Resize sidebar")).toBeNull();
	});

	it("uses a fixed compact sidebar without resizing from 900 to 1199 pixels", () => {
		responsive.constrained = true;
		const { container } = render(<Sidebar />);
		const aside = container.querySelector("aside") as HTMLElement;

		expect(aside.dataset.sidebarLayout).toBe("compact");
		expect(screen.queryByLabelText("Resize sidebar")).toBeNull();
		expect(screen.queryByLabelText("Close sidebar drawer")).toBeNull();
	});

	it("renders a modal drawer with a mask and locked background below 900 pixels", () => {
		responsive.drawer = true;
		responsive.constrained = true;
		const { container, unmount } = render(<Sidebar />);
		const aside = container.querySelector("aside") as HTMLElement;

		expect(aside.dataset.sidebarLayout).toBe("drawer");
		expect(aside.getAttribute("role")).toBe("dialog");
		expect(aside.getAttribute("aria-modal")).toBe("true");
		expect(document.documentElement.classList).toContain("sidebar-drawer-open");
		expect(document.body.style.overflow).toBe("hidden");
		expect(screen.queryByLabelText("Resize sidebar")).toBeNull();

		fireEvent.click(screen.getByLabelText("Close sidebar drawer"));
		expect(toggleSidebar).toHaveBeenCalledTimes(1);
		unmount();
		expect(document.documentElement.classList).not.toContain(
			"sidebar-drawer-open",
		);
	});

	it("closes a drawer with Escape and returns focus to its trigger", () => {
		responsive.drawer = true;
		responsive.constrained = true;
		const trigger = document.createElement("button");
		trigger.textContent = "Open drawer";
		document.body.append(trigger);
		trigger.focus();
		const { unmount } = render(<Sidebar />);

		fireEvent.keyDown(window, { key: "Escape" });
		expect(toggleSidebar).toHaveBeenCalledTimes(1);
		unmount();
		expect(document.activeElement).toBe(trigger);
		trigger.remove();
	});
});
