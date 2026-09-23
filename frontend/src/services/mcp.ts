// MCP client configuration export.
//
// The desktop shell resolves the packaged MCP server binary and the app data
// paths; this service only ferries the ready-to-paste JSON to the UI.

import { invoke } from "@tauri-apps/api/core";

/** Return the MCP client configuration JSON for this installation. */
export async function getMcpConfig(): Promise<string> {
	return invoke<string>("get_mcp_config");
}
