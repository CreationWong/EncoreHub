import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_GLOBAL_CONTEXT_MENU_ITEMS,
	useSettingsStore,
} from "../../stores/settingsStore";
import { useToastStore } from "../../stores/toastStore";

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
const setFullCommunicationLogs = vi.fn();
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
		setFullCommunicationLogs: (enabled: boolean) =>
			setFullCommunicationLogs(enabled),
		restartService: (service: string) => restartService(service),
		databaseOverview: () => databaseOverview(),
		databaseRows: (table: string, limit: number, offset: number) =>
			databaseRows(table, limit, offset),
	},
}));

vi.mock("../../stores/confirmStore", () => ({
	confirm: { ask: (...args: unknown[]) => confirmAsk(...args) },
}));

import DatabasePanel from "./DatabasePanel";
import DeveloperPanel from "./DeveloperPanel";
import LogsPanel from "./LogsPanel";
import ProcessesPanel from "./ProcessesPanel";

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
	localStorage.clear();
	inTauri.mockReset().mockReturnValue(true);
	status.mockReset().mockResolvedValue(statusFixture);
	logs.mockReset().mockResolvedValue(logFixture);
	clear.mockReset().mockResolvedValue(undefined);
	exportLogs.mockReset().mockResolvedValue("C:\\Downloads\\encorehub-logs.txt");
	openLogDirectory.mockReset().mockResolvedValue("C:\\EncoreHub\\log");
	openDevtools.mockReset().mockResolvedValue(undefined);
	getLogLevel.mockReset().mockResolvedValue("info");
	setLogLevel.mockReset().mockResolvedValue(undefined);
	getFileLogLevel.mockReset().mockResolvedValue("info");
	setFileLogLevel
		.mockReset()
		.mockImplementation(async (level: string) => level);
	setFullCommunicationLogs
		.mockReset()
		.mockImplementation(async (enabled: boolean) => enabled);
	restartService.mockReset().mockResolvedValue(statusFixture[1]);
	databaseOverview.mockReset().mockResolvedValue({
		path: "C:\\EncoreHub\\data\\encorehub.db",
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
	useSettingsStore.setState({
		settingsTab: "developer",
		devMode: true,
		fullCommunicationLogs: false,
		globalContextMenuEnabled: true,
		globalContextMenuItems: DEFAULT_GLOBAL_CONTEXT_MENU_ITEMS.map((item) => ({
			...item,
		})),
	});
	useToastStore.setState({ toasts: [] });
});

afterEach(cleanup);

describe("Developer feature workspace", () => {
	it("uses Developer as an index for the separate tools", () => {
		render(<DeveloperPanel />);

		fireEvent.click(screen.getByRole("button", { name: /System processes/ }));
		expect(useSettingsStore.getState().settingsTab).toBe("processes");
	});

	it("controls the EncoreHub context menu from developer settings", () => {
		render(<DeveloperPanel />);
		const toggle = screen.getByRole("switch", {
			name: "Override system context menu",
		});

		fireEvent.click(toggle);

		expect(useSettingsStore.getState().globalContextMenuEnabled).toBe(false);
		expect(localStorage.getItem("encorehub-global-context-menu-enabled")).toBe(
			"0",
		);
	});

	it("shows process state and restarts a managed service", async () => {
		render(<ProcessesPanel />);
		await waitFor(() => expect(screen.getByText("1m 5s")).toBeDefined());

		fireEvent.click(screen.getByRole("button", { name: "Restart gateway" }));
		await waitFor(() => expect(restartService).toHaveBeenCalledWith("gateway"));
	});

	it("keeps restricted logging by default and gates full communication logs", async () => {
		render(<LogsPanel />);
		expect(screen.getByText("Restricted logging")).toBeDefined();

		fireEvent.click(
			screen.getByRole("switch", { name: "Full communication logging" }),
		);
		await waitFor(() =>
			expect(confirmAsk).toHaveBeenCalledWith(
				"Enable full communication logging?",
				expect.stringContaining("Request and response bodies"),
			),
		);
		await waitFor(() =>
			expect(setFullCommunicationLogs).toHaveBeenCalledWith(true),
		);
		expect(useSettingsStore.getState().fullCommunicationLogs).toBe(true);
		expect(screen.getByText(/retained in memory only/)).toBeDefined();
	});

	it("writes logs only after export and treats a cancelled save as a no-op", async () => {
		exportLogs.mockResolvedValueOnce(null);
		render(<LogsPanel />);
		await waitFor(() =>
			expect(screen.getByText("upstream timeout")).toBeDefined(),
		);

		fireEvent.click(screen.getByRole("button", { name: "Export logs" }));

		await waitFor(() => expect(exportLogs).toHaveBeenCalledWith(logFixture));
		expect(useToastStore.getState().toasts).toEqual([]);
	});

	it("renders and filters the standalone log viewer", async () => {
		render(<LogsPanel />);
		await waitFor(() =>
			expect(screen.getByText("upstream timeout")).toBeDefined(),
		);

		fireEvent.change(screen.getByLabelText("Search logs"), {
			target: { value: "listening" },
		});
		expect(screen.getByText("listening on 3000")).toBeDefined();
		expect(screen.queryByText("upstream timeout")).toBeNull();
	});

	it("opens the read-only database as its own page", async () => {
		render(<DatabasePanel />);
		await waitFor(() => expect(databaseOverview).toHaveBeenCalledOnce());
		await waitFor(() =>
			expect(databaseRows).toHaveBeenCalledWith("conversations", 100, 0),
		);
		expect(screen.getByText("Test conversation")).toBeDefined();
		expect(screen.getByText(/encorehub\.db/)).toBeDefined();
	});

	it("shows string errors returned by a database command", async () => {
		databaseOverview.mockRejectedValueOnce("developer mode is not enabled");

		render(<DatabasePanel />);

		await waitFor(() =>
			expect(screen.getByText("developer mode is not enabled")).toBeDefined(),
		);
	});
});
