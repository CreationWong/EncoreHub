/** Conversation attachment upload and deletion client. */

import { AUTH_TOKEN, ApiError } from "./api";
import { apiBase } from "./config";
import { diagnosticFetch } from "./diagnosticFetch";

export interface Attachment {
	id: string;
	conversation_id: string;
	file_name: string;
	mime_type: string;
	file_category: "image" | "rich_text" | "text";
	size_bytes: number;
	processing_status: "pending" | "ready" | "failed";
	processing_method: string;
	error_message: string;
}

/** Fetch original attachment bytes for an authenticated local preview. */
export async function fetchAttachmentContent(
	conversationId: string,
	attachmentId: string,
): Promise<Blob> {
	const headers: Record<string, string> = {};
	if (AUTH_TOKEN) headers.Authorization = `Bearer ${AUTH_TOKEN}`;
	const response = await diagnosticFetch(
		`${apiBase()}/conversations/${conversationId}/attachments/${attachmentId}/content`,
		{ headers },
	);
	if (!response.ok) throw new ApiError(response.status, await response.text());
	return response.blob();
}

/** Upload one file through the Gateway proxy. */
export async function uploadAttachment(
	conversationId: string,
	file: File,
): Promise<Attachment> {
	const form = new FormData();
	form.append("file", file);
	const headers: Record<string, string> = {};
	if (AUTH_TOKEN) headers.Authorization = `Bearer ${AUTH_TOKEN}`;
	const response = await diagnosticFetch(
		`${apiBase()}/conversations/${conversationId}/attachments`,
		{ method: "POST", headers, body: form },
	);
	if (!response.ok) throw new ApiError(response.status, await response.text());
	return response.json() as Promise<Attachment>;
}

/** Delete one draft attachment and its final blob reference. */
export async function deleteAttachment(
	conversationId: string,
	attachmentId: string,
): Promise<void> {
	const headers: Record<string, string> = {};
	if (AUTH_TOKEN) headers.Authorization = `Bearer ${AUTH_TOKEN}`;
	const response = await diagnosticFetch(
		`${apiBase()}/conversations/${conversationId}/attachments/${attachmentId}`,
		{ method: "DELETE", headers },
	);
	if (!response.ok) throw new ApiError(response.status, await response.text());
}
