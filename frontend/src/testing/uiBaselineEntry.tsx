import { mockIPC } from "@tauri-apps/api/mocks";
import ReactDOM from "react-dom/client";
import ClientUiBaseline, { seedClientUiBaseline } from "./ClientUiBaseline";
import { parseClientUiBaselineOptions } from "./clientUiFixtures";
import "../styles/globals.css";

if (!import.meta.env.DEV) {
	throw new Error(
		"The client UI baseline is available only in development mode",
	);
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element #root not found");

const options = parseClientUiBaselineOptions(window.location.search);
if (options.settingsTab === "data") {
	const originalFetch = window.fetch.bind(window);
	window.fetch = async (input, init) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.toString()
					: input.url;
		if (url.endsWith("/api/v1/data/overview")) {
			return Response.json({
				conversations: 3,
				messages: 26,
				attachments: 2,
				attachment_bytes: 184320,
				memories: 7,
				knowledge_documents: 4,
				cache_entries: 11,
			});
		}
		if (url.endsWith("/api/v1/data/conversations")) {
			return Response.json([
				{
					id: "conv-018",
					title: "Tool execution",
					message_count: 12,
					attachment_count: 2,
					updated_at: "2026-08-12T08:30:00Z",
				},
				{
					id: "conv-017",
					title: "Reasoning state",
					message_count: 9,
					attachment_count: 0,
					updated_at: "2026-08-11T10:15:00Z",
				},
				{
					id: "conv-016",
					title: "Release checklist",
					message_count: 5,
					attachment_count: 0,
					updated_at: "2026-08-10T14:45:00Z",
				},
			]);
		}
		return originalFetch(input, init);
	};
}
const developerTabs = ["developer", "processes", "logs", "database"];
if (options.settingsTab && developerTabs.includes(options.settingsTab)) {
	mockIPC((command, args) => {
		switch (command) {
			case "get_developer_mode":
				return true;
			case "set_developer_mode":
				return Boolean((args as { enabled?: boolean } | undefined)?.enabled);
			case "get_full_communication_logs":
				return false;
			case "set_full_communication_logs":
				return Boolean((args as { enabled?: boolean } | undefined)?.enabled);
			case "get_service_status":
				return [
					{
						name: "desktop",
						component: "frontend",
						version: "V0.1.2.0",
						build_id: "260813600474",
						pid: 16420,
						running: true,
						uptime_secs: 0,
						port: 0,
					},
					{
						name: "engine",
						component: "engine",
						version: "V0.1.1.1",
						build_id: "260813600474",
						pid: 16420,
						running: true,
						uptime_secs: 428,
						port: 10000,
					},
					{
						name: "gateway",
						component: "gateway",
						version: "V0.1.1.1",
						build_id: "260813600474",
						pid: 21804,
						running: true,
						uptime_secs: 425,
						port: 10001,
					},
				];
			case "get_logs": {
				const after = Number(
					(args as { after?: number } | undefined)?.after ?? 0,
				);
				return [
					{
						seq: 1,
						source: "desktop",
						level: "warn",
						message: "full communication logging enabled",
					},
					{
						seq: 2,
						source: "frontend",
						level: "info",
						message:
							'[communication] {"direction":"frontend-request","method":"POST","url":"/chat","body":"Find the current build status"}',
					},
					{
						seq: 3,
						source: "gateway",
						level: "info",
						message:
							'channel=communication direction=outbound-response status=200 body={"model":"gpt-4.1"}',
					},
					{
						seq: 4,
						source: "gateway",
						level: "info",
						message:
							"activity=database/write channel=communication method=POST url=http://127.0.0.1:10000/api/conversations",
					},
				].filter((entry) => entry.seq > after);
			}
			case "get_file_log_level":
				return "info";
			case "get_database_overview":
				return {
					path: "C:\\Users\\demo\\AppData\\Roaming\\EncoreHub\\data\\encorehub.db",
					tables: [
						{
							name: "conversations",
							columns: ["id", "title", "model"],
							row_count: 18,
						},
						{
							name: "messages",
							columns: ["id", "role", "content"],
							row_count: 246,
						},
						{
							name: "characters",
							columns: ["id", "name", "version"],
							row_count: 4,
						},
						{ name: "config", columns: ["key", "value_json"], row_count: 12 },
					],
				};
			case "get_database_rows":
				return {
					table:
						(args as { table?: string } | undefined)?.table ?? "conversations",
					columns: ["id", "title", "model"],
					rows: [
						["conv-018", "Tool execution", "gpt-4.1"],
						["conv-017", "Reasoning state", "deepseek-reasoner"],
						["conv-016", "Release checklist", "deepseek-chat"],
					],
					total_rows: 18,
					limit: 100,
					offset: 0,
				};
			default:
				return undefined;
		}
	});
}
const scenario = seedClientUiBaseline(options);
document.title = `EncoreHub UI Baseline - ${scenario.id} - ${options.theme}`;

ReactDOM.createRoot(rootElement).render(<ClientUiBaseline />);

requestAnimationFrame(() => {
	requestAnimationFrame(() => {
		if (scenario.id === "providers-locked") {
			const providerButton = Array.from(
				document.querySelectorAll<HTMLButtonElement>("dialog button"),
			).find((button) => button.textContent?.includes("DeepSeek"));
			providerButton?.click();
		}

		requestAnimationFrame(() => {
			document.documentElement.dataset.uiBaselineReady = "true";
		});
	});
});
