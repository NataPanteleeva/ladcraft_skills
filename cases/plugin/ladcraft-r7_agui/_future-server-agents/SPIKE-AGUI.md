# Spike results (2026-07-29)

API: `https://api.ladcraft.ru`

## Capabilities

`GET /v2/agent/capabilities` → 200. Streaming HTTP+SSE, resumable, tools server-side, HITL interrupts, no WebSocket.

## Run

- `POST /v1/agent/session` → `session_id` = AG-UI `threadId` (nanoid-like, e.g. `zsebnhjcaiAKVVCJfT_JN`).
- `POST /v2/agent/run` Accept `text/event-stream`.
- **IDs:** `runId` and `messages[].id` must be **nanoid-like (~21 chars)**. UUID with hyphens → `400 ID не соответствует формату`. Docs saying “UUID ok” are wrong for this deployment.
- Events seen: `RUN_STARTED`, `STATE_*`, `TEXT_MESSAGE_*`, `REASONING_*`, CUSTOM `eai.message.draft.*`, `eai.message.text.replaced`, `RUN_FINISHED`.
- History after run: assistant message present with `tool_calls` field (empty on trivial turn) — hybrid history sync viable.

## Script

`node cases/plugin/ladcraft-r7_agui/scripts/spike-agui.js`
