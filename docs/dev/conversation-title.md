# Conversation Titles

This document describes how EncoreHub creates and updates conversation titles.

## Purpose

Conversation titles help users quickly identify and return to previous chats.

## Priority

1. Manual title

Users can manually rename a conversation by editing the title in the conversation list. Manual titles must not be overwritten by automatic title generation.

2. Requested title update

When the user asks the LLM to update the conversation title, the model may call the `update_conversation_title` tool. This tool call and its result are shown in the chat like other user-visible tool calls.

3. Automatic title

After the first user message, the gateway starts a hidden title-generation request in parallel with the normal model response. This request is non-streaming and is not shown as a tool call in the chat UI. If it succeeds, the gateway emits a `title_update` SSE event. If it fails after retry, the gateway emits a `title_error` SSE event.

## Limits

- Chinese-only title: at most 20 Chinese characters.
- English-only title: at most 15 words.
- Mixed Chinese/English title: at most 15 characters.
- The title prompt is written in English.
- Title generation uses the conversation's configured model. It must not automatically switch to a non-reasoning or lighter model.
- Title generation disables reasoning/thinking only through provider-native request parameters when supported. For DeepSeek V4-compatible endpoints, the gateway sends `thinking.type=disabled` on the hidden title request.
- The gateway only accepts the normal response `content` as the title. It does not extract titles from `reasoning_content`.
- Automatic title generation has a 30 second timeout.

## Error Handling

If the LLM returns an error or an empty/invalid title, the gateway logs the full title-generation request and response/error, retries up to 3 times, and does not update the title if all attempts fail.

For automatic generation failures, the gateway emits `title_error`; the frontend shows an error toast and does not make a second fallback title-generation request.
