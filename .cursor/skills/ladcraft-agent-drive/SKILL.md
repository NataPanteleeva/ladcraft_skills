---
name: ladcraft-agent-drive
description: Drives a LIVE Ladcraft agent programmatically over the chat/runtime API (api.ladcraft.ru) — create a session, upload a file to /session/, send a message, monitor state live via SSE (or poll activity as a fallback), and fetch the full tool-call history. Use when the user asks to run an agent, batch-run example inputs, reproduce/audit an agent dialog, smoke-test a skill end-to-end, monitor an agent's run state, or otherwise interact with an agent without the web UI.
---

# Ladcraft agent drive (chat / runtime API)

This is the **data plane** (talking to a running agent). It is separate from the
**control plane** (publishing/binding skills & agents) — see the `ladcraft-prod-publish`
skill for that. Don't mix the two: a session/run is not an application install.

This hits a **real prod account**. Sending a message spends real model time and
creates a real dialog. Confirm with the user before launching runs, and especially
before launching batches.

## Setup (always first)

- All config comes from the repo `.env` (auto-loaded from CWD; run the driver from the repo root):
  - `LADCRAFT_EMAIL` — account email (login).
  - `LADCRAFT_PASSWORD` — account password.
  - `LADCRAFT_API_URL` — API base URL: prod `https://api.ladcraft.ru`, dev `https://api.dev.e-ai.ladcloud.ru`.
    The driver reads it from `.env`; don't hardcode it in commands.
- The **live `agent_id`** is required for every command. Pass `--agent <id>` or set
  `LC_AGENT_ID`. Get it from the publish skill: `agent-list --title "<title>"`.
  (The bundle's embedded `agent_id` and the installed-application id are NOT it.)
- Verify auth: `node .cursor/skills/ladcraft-agent-drive/scripts/lc_agent_drive.js auth`

## One-shot run (most common)

`run` does the whole loop: new session → upload file to `/session/` → send message →
poll `activity` until the run leaves the active list → write full history to JSON.

```bash
node .cursor/skills/ladcraft-agent-drive/scripts/lc_agent_drive.js \
  run /abs/path/input.docx --agent <agentId> --msg "<your prompt>" \
  --out /tmp/run.json --timeout-ms 600000 --interval-ms 10000
```

The file argument is optional — for a text-only task, omit it and pass just `--msg`
(no upload step runs).

For a batch, launch each input in its **own session** (one dialog per input). Run a
few in parallel, but keep concurrency modest — runs slow down under contention, and
the activity poll is the only progress signal.

## Lower-level commands

```bash
lc_agent_drive.js session-create --agent <id>          # -> { session_id }
lc_agent_drive.js upload-workspace <wsId> <file> [dest] # upload into /workspace (KB / "Файлы агента")
lc_agent_drive.js launch <file> --agent <id> [--msg S] # session + upload + message
lc_agent_drive.js say <sessionId> --msg S              # message into an EXISTING session (also answers a question)
lc_agent_drive.js active --agent <id>                  # only-active runs -> { items:[{session_id, activity_state}] }
lc_agent_drive.js history <sessionId> [--out f.json]   # full transcript -> { data:[...] }
lc_agent_drive.js vfs-list <scope> [--workspace|--session|--space <id>] [--path P] [--hierarchical]
lc_agent_drive.js vfs-delete <scope> <path> [--workspace <id>]  # delete file OR folder (recursive)
lc_agent_drive.js vfs-quota <scope> [--workspace <id>]          # scope=workspace|space only
```

## Verified endpoints (reverse-engineered via chrome-devtools MCP)

| Purpose | Request |
|---|---|
| Login | `POST /v1/auth/login` `{email, password}` → `access_token` |
| Create session | `POST /v1/agent/session` `{agent_id}` → `{session_id}` |
| Upload file | `POST /v1/agent/vfs/upload` multipart: `scope=session`, `session_id`, `sync=true`, `file` → `{file_id, ...}` |
| Send message | `POST /v1/agent/session/{sid}/message` `{content, assistant_mode:"execution", files:{attached:[{file_id,file_name}]}}` |
| Poll activity (coarse) | `GET /v1/agent/activity?agent_id=<id>&only_active=true` → `{items:[{session_id, activity_state}]}` |
| **Live events (SSE)** | `GET /v1/agent/sse/{session_id}` `Accept: text/event-stream` + Bearer → push stream |
| History | `GET /v1/agent/session/{sid}/history?page=1&size=99999` → `{data:[ messages ]}` |

## Live monitoring via SSE (react instead of polling on a timer)

The web UI does **not** busy-poll for state; it opens a **Server-Sent Events** stream per session and
reacts to pushed events. Use the same channel to watch a run live (verified via chrome-devtools MCP):

```
GET /v1/agent/sse/{session_id}      Accept: text/event-stream   Authorization: Bearer <token>
GET /v1/agent/sse/ws_{workspace_id} # workspace-level fan-out (all sessions of the agent)
GET /v1/notifications/stream?connection_version=0  # account-level notifications
```

The body is SSE: pairs of `event: <type>\n` + `data: <json>\n\n`. The JSON is
`{session_id, type, data, timestamp}`. Event taxonomy (observed end-to-end):

- **Lifecycle**: `task_state_changed`, `run_state_changed` with `data.state ∈ {queued → running →
  waiting_user_response → cancelled → (re-queued) → … → completed}` (also `failed`). These are the authoritative
  transitions. NB: in execution mode a multi-round ReAct run cycles `running → waiting_user_response → cancelled
  → queued → running` **per round and auto-continues** — that is **not** a stop and **not** a question to the
  user (verified: a run with 0 `requestUserInput`/`requestApproval` calls still cycled through
  `waiting_user_response`). Only `completed`/`failed` are terminal; a genuine question to the user shows up as a
  `requestUserInput`/`requestApproval` tool call (and `activity` reports `requires_user_action`).
- `intake_start` / `intake_end` (`stage: task_statement`) — task statement processing.
- **Assistant turn**: `message_start` → `content_delta` (token-by-token) → `content_done` →
  `assistant_message_snapshot` → `message_done` (`data.status: "completed"`).
- `context_usage_updated` (token usage), `session_updated`, `agent_access_updated`.
- `ping` — keep-alive every ~5 s. (No domain event for ~minutes = idle, not hung.)

**Driver rule (no timeouts):** treat the turn finished **only** on `run_state_changed`/`task_state_changed`
`state=completed` (or `failed`), or when the session leaves the `activity` active list. Do **not** treat
`waiting_user_response`/`cancelled` as done — they recur every ReAct round and the run auto-continues. A real
"waiting for user" is a `requestUserInput`/`requestApproval` tool call; the coarse
`GET /v1/agent/activity?...&only_active=true` then reports `activity_state: "requires_user_action"` (vs `working`). The stream is periodically closed by the server (`net::ERR_ABORTED`
in DevTools) and the client reconnects — re-open on EOF. Minimal reader:

```js
const sse = await fetch(`${BASE}/v1/agent/sse/${sid}`, {headers:{Authorization:`Bearer ${tok}`, accept:'text/event-stream'}});
const reader = sse.body.getReader(); const dec = new TextDecoder(); let buf='';
while(true){ const {value,done}=await reader.read(); if(done)break; buf+=dec.decode(value,{stream:true});
  let i; while((i=buf.indexOf('\n\n'))>=0){ const c=buf.slice(0,i); buf=buf.slice(i+2);
    const ev=(c.match(/^event:\s*(.*)$/m)||[])[1]; const data=(c.match(/^data:\s*([\s\S]*)$/m)||[])[1];
    /* react to ev/data here: message_done / run_state_changed=completed => turn finished */ } }
```

History message shape: `{ role, content, tool_calls: [ { name, command|arguments, result, status } ] }`.
For bash tools the call is under `command`; for skill tools the input is under `arguments`
and the tool output under `result` (often already-parsed objects, sometimes JSON strings — handle both).

## Answering a closed question (`requestUserInput` / `requestApproval`) — verified

When the agent asks the user (the «Вопрос пользователю» / «Запрос подтверждения» tools), the run
parks in `waiting_user_response` and `GET /v1/agent/activity?...&only_active=true` reports
`activity_state: "requires_user_action"` (vs `working`). The structured question is exposed two ways:

- **SSE event `user_input_required`** — `data` has `{action_id, type:"form", prompt,
  question_kind:"clarification"|..., questions:[{id, question, allow_text_response, options?}], next_phase,
  primary_text_already_in_message, response_message_visible_in_chat}`. A **multiple-choice** question adds
  `questions[].options:[{id, label}]` (the buttons the UI renders); `allow_text_response` says whether a
  free-text reply is also accepted (commonly `true`). The question text is **also** emitted
  as a normal assistant message (`message_start`→`content_done`), and in `history` it appears as a plain
  `assistant` `text` message (the snapshot's `tool_calls` may be `null`).
- **`activity` → `waiting_action`** — the same object (`action_id`, `questions[]`, `allow_text_response`)
  is on the active item, so a poller that missed the SSE event can still read the pending question.

**You answer it by sending a normal message to the SAME session** (no special endpoint, no `action_id`
needed for a text answer): `POST /v1/agent/session/{sid}/message {content, assistant_mode:"execution"}`,
i.e. `lc_agent_drive.js say <sessionId> --msg "<answer>"`. The runtime correlates the plain message with
the pending action (because the session is `waiting_user_response`) and **resumes the SAME `task_id` with a
new `run_id`** (verified: state `waiting_user_response → running`). The answer is recorded as a regular
`user` `text` message in `history`. After answering, watch the stream again — the agent may reach
`completed` or ask **another** question (back to `requires_user_action`); loop `say` until the run is
terminal. (Verified on both a **free-text** `clarification` question and a **multiple-choice** one with
`options:[{id,label}]` — both `allow_text_response:true`: replying with the option **label** as plain text
resumed the same `task_id`. An approval-type `requestApproval` is the same channel — reply with the decision
text.)

## Auditing an agent dialog (general pattern)

1. Build **ground truth** locally (e.g. parse the source files independently).
2. `run` each input in its own session; collect the `--out` history JSONs.
3. Extract the agent's structured output from `tool_calls` — typically the arguments of a
   validation/render tool, or the final assistant message. Take the **last** occurrence of
   the relevant call.
4. Diff against ground truth; classify ERROR vs WARN; normalize obvious formatting
   differences to avoid false positives.

## Multi-agent runtime: delegation & shared files (verified)

When a parent agent orchestrates worker agents (relation `delegates_to`, set via the publish skill):

- **`delegateToAgent` is asynchronous.** The call returns `{status:"pending", delegated_session_id}`;
  the worker's result lands in the **parent's next step**, not as the call's return value. The worker
  runs in its own separate session/context. `delegateToAgents` (batch) returns an envelope
  `{status:"pending", delegation_batch_id, join_policy, items:[...]}`.
- **Pass pointers, not full text.** Returning a large block of text through the delegation result is
  expensive (it inflates the parent's context) and small models tend to truncate/summarize it. Have the
  worker **write the payload to a shared file and return only `{path, length}`**; the parent records the
  pointer and a later step reads the file via a skill tool (text never enters the parent's context).
- **`delegateToAgents` (batch) does work and gives real parallelism** — but on small models the `requests`
  array is sometimes emitted as a *string* and rejected (`TOOL_ERROR`). It becomes reliable when each item is
  **short and uniform** (a tiny instruction + a fenced `json` payload) and the orchestration does **not**
  depend on parsing the workers' free-text answers (see patterns below). Earlier guidance to "delegate one
  at a time" was a small-model workaround, not a platform limit.

### Multi-agent orchestration patterns (universal, model-agnostic)

These patterns make orchestrator↔worker coordination robust on weak models. They are domain-independent — apply
them to any case (the contract case is just one instance).

- **Files are the source of truth, not the worker's `RESULT` text.** A worker can write its file correctly and
  then finish with prose that omits the expected `RESULT:` line → the parent falsely retries. After a wave,
  **verify the files exist on disk** (list the shared VFS, or a tiny read-only skill tool that returns
  `{present, missing}`) and **retry only the `missing`** items. Never gate progress on parsing free text.
- **Deterministic paths beat agreed conventions.** A worker left to choose its own ids/paths will *invent*
  them (it copies example ids from the instruction), so the parent and worker drift apart. Fix: the parent
  assigns the **exact output `path`** (and any `processing_id`) at registration time and passes it **verbatim**
  in the delegation `task`; the worker is told to use the given `path` literally and never to fabricate one.
- **Put shared context in one canonical file, read via a tool — don't re-narrate it.** If the parent retells
  the task params in every delegation, it hallucinates different values across retries. Instead write the
  canonical inputs once to a shared file (e.g. `/user/<run>/context.json`) and give the worker a tool to read
  it. The delegation `task` then carries only ids/paths, not the full context.
- **Workers must write via the designated skill tool, not `bash`.** A worker that writes to `/session/.tmp/...`
  via shell does **not** update the shared `/user` layer the parent reads. State this explicitly in the worker
  instruction.
- **Size parallel waves to the concurrency cap — don't send one giant wave.** `join_policy: "wait_all"` returns
  only when **every** item in the wave is done, so the wave is gated by the **slowest** worker. Per-worker
  latency is the real bottleneck (cold context + skill load + `fileSearch` + drafting ≈ several minutes). One
  huge wave blocks the parent for ~⌈N/cap⌉ × slowest-worker. Practical sweet spot: **waves of ≈6** at
  `max_parallel_runs:8` + a `missing`-only top-up wave. Raising the cap alone does **not** speed things up if
  the bottleneck is worker latency.
- **Concurrency is capped by `delegation.max_parallel_runs` (default 4).** A batch of N runs at most `cap`
  workers at once; the chat shows it as "Параллельные агенты: N". See the `ladcraft-prod-publish` skill /
  `ladcraft-prod-publishing` rule for the BETA settings and how to change them via `agent-policy`.

### VFS scopes / roots (semantics, sharing, UI visibility)

The path root decides where a file is bound, who sees it, and whether it shows in the web UI. Canonical model:

| Root | Bound to / sharing | Shown in web UI? |
|---|---|---|
| `/session` | the current session/dialog — a **temporary layer over workspace** | **Yes — "Файлы чата"** button (per-chat) |
| `/workspace` | the agent's working area — **the main user-visible file contour**; relative paths usually resolve here | **Yes — "Файлы агента"** panel (KB dirs + uploaded/created files) |
| `/user` | `space_id + user_id` (no workspace/session) — shared across **that user's** agents | **No** — invisible in the UI |
| `/space` | `space_id` only (no user/workspace/session) — shared across the **whole space/org** | **No** — invisible in the UI |

Verified via chrome-devtools MCP: the UI exposes exactly two file areas — **"Файлы чата" = `/session`** and
**"Файлы агента" = `/workspace`**. `/user` and `/space` have **no UI file browser**; they are reachable only by
the agent/runtime via VFS tools (mounted roots `/workspace /session /user /space`). The "Файлы агента" panel does
**not** auto-refresh on API-side changes — reload the page. The Knowledge Base (the `fileSearch` index) lives in
`/workspace` (e.g. `methodology/ precedents/ regulations/ templates/`).

**Merged read order:** `session → workspace → user → space` — a same-named file in a closer scope overrides the
shared layer. Pick the scope by access boundary: one user → `/user`, whole company/space → `/space`, one
workspace → `/workspace`.

**Placement policy (authoritative — use these defaults):**
- **`/user/...`** → inter-agent file exchange (one user's agents share a long-lived layer). E.g. worker block
  drafts that the orchestrator must read. Invisible in UI, that's fine.
- **`/session/...`** → files relevant **only to one specific run** (transient).
- **`/workspace/...`** → files that must **always be visible to the user inside the agent** (the deliverable the
  user wants to see/keep — assembled draft, memo). They appear under "Файлы агента". Organize under a subfolder
  (e.g. `/workspace/contracts/{id}/`) — never scatter loose files into `/workspace` root next to the KB dirs.
- `/space/...` → only when sharing across the entire space/org (different users), not just one user's agents.

**Inspect / manage VFS over the API (verified endpoints):**
- List: `GET /v1/agent/vfs/files?scope=session|workspace|user|space[&session_id|workspace_id|space_id=...]&page=1&size=9999&hierarchical=true|false`
  (the files endpoint accepts `scope=user`).
- Upload: `POST /v1/agent/vfs/upload` multipart `{scope, [workspace_id|session_id], path, sync:true, file}`.
  `path` is the **full destination path incl. filename** within the scope (e.g. `methodology/triage_spec.json`
  → `~/workspace/methodology/triage_spec.json`). Use the `upload-workspace` subcommand to load a KB into
  `/workspace` (e.g. `methodology/ advice/ antipatterns/ pep_talks/`) so `fileSearch` can index it.
- **Delete file *or* folder** (single endpoint): `DELETE /v1/agent/vfs/folders?scope=...&[workspace_id=...]&path=<full path, e.g. ~/workspace/_work>`
  → `{path, deleted_count, status}`. **Send no request body** — a `content-type: application/json` header with
  an empty body returns `400 "Body cannot be empty"`. There is **no** `/v1/agent/vfs/file(s)` DELETE route
  (those 404). Recurse with the full `~/scope/...` path that the listing returns.
- Quota: `GET /v1/agent/vfs/quota?scope=workspace|space` (rejects `scope=user`).

### sql-storage is per-agent

`sql-storage` is **not** shared between agents: `GET /v1/storage/by-agent/{agentId}` returns each agent's
own `storage_id` (empty for a fresh agent). Keep a shared registry with a single owner agent and put
cross-agent payloads in shared VFS (`/user`). A skill can self-init its storage (add `create` to the
capability `operations` and call `sql.create()` when `sql.get()` is empty).

## Gotchas (verified)

- The web UI authenticates with cookies (`credentials: 'include'`); a `fetch` in
  DevTools without it gets `401`. From a script, use the Bearer token from login.
- `activity` only reports **active** runs; a finished run simply disappears from
  `items` — treat "not in the list" as done, not as an error.
- The `history` snapshot of an in-progress assistant message can lag (it may show
  fewer `tool_calls` than already executed). Don't conclude a run is stuck from one
  stale snapshot — confirm with `activity`.
- Response envelopes vary: some are `{result:{items:[...]}}`, some `{data:[...]}`,
  some `{data:{applications:[...]}}`. Unwrap `result` first, then probe `items`/`data`.
- Uploaded files land in `/session/` (with a parsed `*_parsed.md` companion when the
  agent has `keep_original_and_parse_copy`). Tell the agent to read the `/session/`
  input, not stale files in `/workspace`.
