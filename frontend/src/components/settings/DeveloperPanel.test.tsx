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
const exportLogs = vi.fn();
const openLogDirectory = vi.fn();
const openDevtools = vi.fn();
const getLogLevel = vi.fn();
const setLogLevel = vi.fn();
const getFileLogLevel = vi.fn();
const setFileLogLevel = vi.fn();
const restartService = vi.fn();
const databaseOverview = vi.fn();
const databaseRows = vi.fn();
const inTauri = vi.fn();
const confirmAsk = vi.fn();

vi.mock("../../services/devtools", () => ({
	inTauri: () => inTauri(),
	devtools: {
		status: () => status(),
		logs: (after: number) => logs(after),
		clear: () => clear(),
		exportLogs: (entries: unknown[]) => exportLogs(entries),
		openLogDirectory: () => openLogDirectory(),
		openDevtools: () => openDevtools(),
		getLogLevel: () => getLogLevel(),
		setLogLevel: (level: string) => setLogLevel(level),
		getFileLogLevel: () => getFileLogLevel(),
		setFileLogLevel: (level: string) => setFileLogLevel(level),
		restartService: (service: string) => restartService(service),
		databaseOverview: () => databaseOverview(),
		databaseRows: (table: string, limit: number, offset: number) =>
			databaseRows(table, limit, offset),
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
	exportLogs
		.mockReset()
		.mockResolvedValue("C:\\Users\\test\\Downloads\\encorehub-logs.txt");
	openLogDirectory
		.mockReset()
		.mockResolvedValue("C:\\Users\\test\\EncoreHub\\log");
	openDevtools.mockReset().mockResolvedValue(undefined);
	getLogLevel.mockReset().mockResolvedValue("info");
	setLogLevel.mockReset().mockResolvedValue(undefined);
	getFileLogLevel.mockReset().mockResolvedValue("info");
	setFileLogLevel
		.mockReset()
		.mockImplementation(async (level: string) => level);
	restartService.mockReset().mockResolvedValue(statusFixture[1]);
	databaseOverview.mockReset().mockResolvedValue({
		path: "C:\\Users\\test\\EncoreHub\\data\\encorehub.db",
		tables: [{ name: "conversations", columns: ["id", "title"], row_count: 1 }],
	});
	databaseRows.mockReset().mockResolvedValue({
		table: "conversations",
		columns: ["id", "title"],
		rows: [["conv-1", "Test conversation"]],
		total_rows: 1,
		limit: 100,
		offset: 0,
	});
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

	it("exports the filtered logs through the native desktop command", async () => {
		render(<DeveloperPanel />);
		await waitFor(() =>
			expect(screen.getByText("upstream timeout")).toBeDefined(),
		);

		fireEvent.click(screen.getByLabelText("Export logs"));

		await waitFor(() => expect(exportLogs).toHaveBeenCalledWith(logFixture));
		await waitFor(() =>
			expect(
				useToastStore
					.getState()
					.toasts.some((toast) => toast.message.includes("encorehub-logs.txt")),
			).toBe(true),
		);
	});

	it("opens the active native log directory", async () => {
		render(<DeveloperPanel />);
		await waitFor(() => expect(status).toHaveBeenCalled());

		fireEvent.click(screen.getByLabelText("Open log folder"));

		await waitFor(() => expect(openLogDirectory).toHaveBeenCalledOnce());
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

	it("restarts the selected local service after confirmation", async () => {
		render(<DeveloperPanel />);
		await waitFor(() => expect(status).toHaveBeenCalled());

		fireEvent.click(screen.getByRole("button", { name: "Restart gateway" }));

		await waitFor(() => expect(confirmAsk).toHaveBeenCalled());
		await waitFor(() => expect(restartService).toHaveBeenCalledWith("gateway"));
	});

	it("opens a read-only paginated database browser", async () => {
		render(<DeveloperPanel />);
		fireEvent.click(screen.getByRole("tab", { name: "Database" }));

		await waitFor(() => expect(databaseOverview).toHaveBeenCalledOnce());
		await waitFor(() =>
			expect(databaseRows).toHaveBeenCalledWith("conversations", 100, 0),
		);
		expect(screen.getByText("Test conversation")).toBeDefined();
		expect(screen.getByText(/encorehub\.db/)).toBeDefined();
	});
});
