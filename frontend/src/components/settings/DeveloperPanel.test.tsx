import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const status = vi.fn();
const logs = vi.fn();
const clear = vi.fn();
const inTauri = vi.fn();

vi.mock("../../services/devtools", () => ({
	inTauri: () => inTauri(),
	devtools: {
		status: () => status(),
		logs: (after: number) => logs(after),
		clear: () => clear(),
	},
}));

import { useToastStore } from "../../stores/toastStore";
import DeveloperPanel from "./DeveloperPanel";

const statusFixture = [
	{ name: "desktop", pid: 100, running: true, uptime_secs: 0, port: 0 },
	{ name: "engine", pid: 200, running: true, uptime_secs: 65, port: 3000 },
	{ name: "gateway", pid: null, running: false, uptime_secs: 0, port: 8080 },
];

const logFixture = [
	{ seq: 1, source: "engine", level: "info", message: "listening on 3000" },
	{ seq: 2, source: "gateway", level: "error", message: "upstream timeout" },
];

beforeEach(() => {
	inTauri.mockReset().mockReturnValue(true);
	status.mockReset().mockResolvedValue(statusFixture);
	logs.mockReset().mockResolvedValue(logFixture);
	clear.mockReset().mockResolvedValue(undefined);
	useToastStore.setState({ toasts: [] });
});

afterEach(cleanup);

describe("DeveloperPanel", () => {
	it("renders a placeholder when not running in Tauri", () => {
		inTauri.mockReturnValue(false);
		render(<DeveloperPanel />);
		expect(screen.getByText(/only available in the desktop app/)).toBeDefined();
	});

	it("renders status cards with pid/port/uptime", async () => {
		render(<DeveloperPanel />);
		await waitFor(() => expect(status).toHaveBeenCalled());
		await waitFor(() => {
			// pid / port / uptime are unique to the status cards (the service
			// names also appear as filter <option>s, so we assert on these).
			expect(screen.getByText("200")).toBeDefined();
			expect(screen.getByText("3000")).toBeDefined();
			expect(screen.getByText("1m 5s")).toBeDefined();
		});
		// gateway is down
		expect(screen.getByText("down")).toBeDefined();
	});

	it("renders log lines pulled from the buffer", async () => {
		render(<DeveloperPanel />);
		await waitFor(() => expect(logs).toHaveBeenCalledWith(0));
		await waitFor(() => {
			expect(screen.getByText("listening on 3000")).toBeDefined();
			expect(screen.getByText("upstream timeout")).toBeDefined();
		});
	});

	it("filters logs by search query", async () => {
		render(<DeveloperPanel />);
		await waitFor(() =>
			expect(screen.getByText("upstream timeout")).toBeDefined(),
		);

		fireEvent.change(screen.getByLabelText("Search logs"), {
			target: { value: "listening" },
		});
		expect(screen.getByText("listening on 3000")).toBeDefined();
		expect(screen.queryByText("upstream timeout")).toBeNull();
	});

	it("filters logs by level", async () => {
		render(<DeveloperPanel />);
		await waitFor(() =>
			expect(screen.getByText("upstream timeout")).toBeDefined(),
		);

		fireEvent.change(screen.getByLabelText("Filter by level"), {
			target: { value: "error" },
		});
		expect(screen.queryByText("listening on 3000")).toBeNull();
		expect(screen.getByText("upstream timeout")).toBeDefined();
	});

	it("clears logs via the clear button", async () => {
		render(<DeveloperPanel />);
		await waitFor(() =>
			expect(screen.getByText("upstream timeout")).toBeDefined(),
		);

		fireEvent.click(screen.getByLabelText("Clear logs"));
		await waitFor(() => expect(clear).toHaveBeenCalled());
		await waitFor(() =>
			expect(screen.queryByText("upstream timeout")).toBeNull(),
		);
	});
});
