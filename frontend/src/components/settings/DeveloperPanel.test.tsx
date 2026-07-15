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
const openDevtools = vi.fn();
const getLogLevel = vi.fn();
const setLogLevel = vi.fn();
const getFileLogLevel = vi.fn();
const setFileLogLevel = vi.fn();
const inTauri = vi.fn();
const confirmAsk = vi.fn();

vi.mock("../../services/devtools", () => ({
	inTauri: () => inTauri(),
	devtools: {
		status: () => status(),
		logs: (after: number) => logs(after),
		clear: () => clear(),
		openDevtools: () => openDevtools(),
		getLogLevel: () => getLogLevel(),
		setLogLevel: (level: string) => setLogLevel(level),
		getFileLogLevel: () => getFileLogLevel(),
		setFileLogLevel: (level: string) => setFileLogLevel(level),
	},
}));

vi.mock("../../stores/confirmStore", () => ({
	confirm: { ask: (...args: unknown[]) => confirmAsk(...args) },
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
	openDevtools.mockReset().mockResolvedValue(undefined);
	getLogLevel.mockReset().mockResolvedValue("info");
	setLogLevel.mockReset().mockResolvedValue(undefined);
	getFileLogLevel.mockReset().mockResolvedValue("info");
	setFileLogLevel
		.mockReset()
		.mockImplementation(async (level: string) => level);
	confirmAsk.mockReset().mockResolvedValue(true);
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

	it("loads and changes the runtime log level", async () => {
		render(<DeveloperPanel />);
		await waitFor(() => expect(getLogLevel).toHaveBeenCalled());

		fireEvent.change(screen.getByLabelText("Set runtime log level"), {
			target: { value: "debug" },
		});
		await waitFor(() => expect(setLogLevel).toHaveBeenCalledWith("debug"));
	});

	it("loads and changes the file log level", async () => {
		render(<DeveloperPanel />);
		await waitFor(() => expect(getFileLogLevel).toHaveBeenCalled());

		fireEvent.change(screen.getByLabelText("Set file log level"), {
			target: { value: "warn" },
		});
		await waitFor(() => expect(setFileLogLevel).toHaveBeenCalledWith("warn"));
	});

	it("warns before enabling debug file logs", async () => {
		render(<DeveloperPanel />);
		await waitFor(() => expect(getFileLogLevel).toHaveBeenCalled());

		fireEvent.change(screen.getByLabelText("Set file log level"), {
			target: { value: "debug" },
		});

		await waitFor(() =>
			expect(confirmAsk).toHaveBeenCalledWith(
				"Enable debug file logs?",
				expect.stringContaining("grow quickly"),
			),
		);
		await waitFor(() => expect(setFileLogLevel).toHaveBeenCalledWith("debug"));
	});

	it("does not enable debug file logs when the warning is cancelled", async () => {
		confirmAsk.mockResolvedValue(false);
		render(<DeveloperPanel />);
		await waitFor(() => expect(getFileLogLevel).toHaveBeenCalled());

		fireEvent.change(screen.getByLabelText("Set file log level"), {
			target: { value: "debug" },
		});

		await waitFor(() => expect(confirmAsk).toHaveBeenCalled());
		expect(setFileLogLevel).not.toHaveBeenCalled();
	});
});
