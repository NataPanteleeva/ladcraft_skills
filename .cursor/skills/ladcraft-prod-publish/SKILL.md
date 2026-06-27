---
name: ladcraft-prod-publish
description: Publishes and modifies Ladcraft skills and agents on the prod server (api.ladcraft.ru), keeping the two entities strictly separate. Use when the user asks to publish, update, import, install, or bind a Ladcraft skill or agent, or to repoint/patch an agent's instruction.
---

# Ladcraft prod: publish & modify (skill vs agent)

A skill (`application` type `skill`) and an agent (`application` type `agent` → installed live agent) are **different entities** with **different lifecycles**. Never conflate their ids or endpoints.

This skill is the **control plane** (create/update/install/bind/patch). To *run* a live
agent (sessions, upload, message, poll, history) use the `ladcraft-agent-drive` skill.

This is a **real prod account**. Confirm the action with the user before any write (create/import/install/patch/bind).

## Setup (always first)

- All config comes from the repo `.env` (the helper auto-loads it from the CWD):
  - `LADCRAFT_EMAIL` — account email (login).
  - `LADCRAFT_PASSWORD` — account password.
  - `LADCRAFT_API_URL` — API base URL: prod `https://api.ladcraft.ru`, dev `https://api.dev.e-ai.ladcloud.ru`.
- Do **not** hardcode the base URL in commands — it is read from `.env`. Override only by
  editing `.env` (or exporting the var) when switching prod/dev.
- A `.env.example` documents these keys. The user's active env can be cross-checked in
  `~/Library/Application Support/ladcraft-skills-studio/ladcraft-skills-studio-settings.json` → `ladcraft.activeEnv`.
- Verify auth before anything else (run from the repo root so `.env` is found):

```bash
node .cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js auth
```

## Decide the entity

```
Task Progress:
- [ ] 1. Identify: is this a SKILL or an AGENT? (separate workflows below)
- [ ] 2. Verify env + auth
- [ ] 3. Execute the matching workflow
- [ ] 4. Verify result
```

---

## SKILL workflow (`application` type `skill`)

A skill lives as a folder inside a **case** — `cases/<case_name>/` groups a skill folder with
its agent folder. The shared canon is the repo-root `.pi/` (`<repo>/.pi/`); the legacy case
`lc_contract_creator/` still sits at the repo root. The skill folder is the source of truth;
its basename is the skill slug.

### Publish-from-source prerequisites (validator will block otherwise)

- Folder basename **must equal** `SKILL.md` frontmatter `name`.
- Python tools: add `scriptFile: <tool>.py` to each `scripts/<tool>.meta.md` (the packager defaults to `.js`).
- `resources` ranges: `cpu` 0.1..1, `memory` 64..256 (int), `timeout` 1..3600 (sec).
- To publish a renamed/test variant, copy the folder (exclude `.git`, `.build`, `.remote-cache`, `.skill-backups`, `.from-server.json`), then set the new `name` = new folder basename.

### Create / update (recommended: toolkit packager)

If the Ladcraft KB toolkit is available (`ladcraft_kb/ladcraft_solutions_design_and_delivery/test_and_deploy_tools`),
its packager builds the folder into a valid payload and creates (private) or updates by slug.
It reads `LADCRAFT_EMAIL`/`LADCRAFT_PASSWORD`/`LADCRAFT_API_URL` from the environment, so export
them from `.env` first (the packager does not auto-load `.env`):

```bash
set -a; . "$(git rev-parse --show-toplevel)/.env"; set +a
cd <repo>/ladcraft_kb/ladcraft_solutions_design_and_delivery/test_and_deploy_tools
node scripts/publish-skill.js -- <absolute-skill-dir>   # add --diff to preview
```

- Skills are always created `private`. New skill → `POST /v1/application/skill`. Existing slug → `PATCH /v1/application/skill/{id}`.
- Update is **read-before-write**: it fetches the remote skill and carries existing `tools[].id` so tool identities are preserved.

### Modify an existing skill (raw API)

Read first, then patch. With the helper:

```bash
node .cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js skill-get <appId>
node .cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js skill-update <appId> patch.json
```

`PATCH /v1/application/skill/{id}` body uses `title`, `description`, `detailed_description`, `category`, `tags`, `tools[]` (carry `id`), `cause`. For folder-based edits prefer the toolkit packager above.

The server **assigns the version itself** on update — it does not honor the `version`
you send (e.g. a `1.1.0`→`1.1.1` payload came back as `2.0.0`). Treat the `version`
in the response as authoritative; don't assert on the value you sent.

When the full-payload `skill-update` is accepted, every tool's inlined `function`
is replaced wholesale, so this is also how you ship Python helper/code changes
(there is no separate per-file upload). Rebuild the payload (re-inline shared
`general.lib`/helper code into each tool's `function`) before updating.

### Payload shape when there is NO packager (verified)

`skill-create`/`skill-update` expect a **flat** body (the `skill` field is a **slug string**, not a
nested object):

```json
{
  "skill": "<slug>",                // == folder basename == SKILL.md name
  "name": "...", "description": "...", "detailed_description": "...",
  "tags": [], "version": "1.0.0", "category": "...", "icon": "...",
  "tools": [
    {
      "id": "<existing-tool-id>",   // omit on create / for brand-new tools (server assigns)
      "name": "...", "description": "...",
      "runtime": "nodejs@24",       // python tools: "python@3"
      "schemas": { "input": {...}, "output": {...} },
      "function": "<handler + inlined general.lib>",
      "capabilities": { "required": [ { "type": "vfs", "scope": "$USER", "operations": [...] } ] },
      "environment": { "app": {}, "user": {} },
      "resources": { "cpu": 0.2, "memory": 128, "timeout": 60, "network": { "hosts": [] } }
    }
  ]
}
```

Build it yourself from the folder: per tool, concatenate `scripts/<tool>.js` (`handler`) **first**,
then the shared `general.lib` body (JS function declarations hoist, so order is safe), into `function`;
take `capabilities`/`schemas`/`resources` from `*.meta.md` or `SKILL.md` `mcp_spec.default_capabilities`.
On `skill-update`, carry each existing `tools[].id` (from `skill-get`); a tool with no `id` is created
fresh. The server still picks the final `version`.

### Find a skill's app id

```bash
node .cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js \
  req GET "/v1/application/list?type%5B%5D=skill&return_installed=true"
```

This list returns `data.applications` (an array) — **not** `data.items`. Match on
`name`/`title` to get `id`, `version`, `status`.

---

## AGENT workflow (`application` type `agent` → live agent)

An imported agent bundle is a **template**, not a usable agent. You must install it to get a live `agent_id`.

### Publish an agent from a `.application.ladcraft` bundle

```bash
# 1) Import the bundle (multipart, field "file"). Returns a template application id.
node .cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js agent-import <bundle> --title "<title>"
#    -> { application_id, type: "agent" }   # TEMPLATE, not live

# 2) Materialize a live agent.
node .cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js agent-install <application_id>
#    -> { application_id, installed_application_id }

# 3) Find the live agent_id (the installed id is NOT the agent_id).
node .cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js agent-list --title "<title>"
#    -> { agents: [ { agent_id, title, ... } ] }
```

Alternative — create a live agent directly (no bundle) from an instruction file with `agent-create`
(optionally setting the model in the same call):

```bash
node .cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js \
  agent-create --title "<title>" --instruction-file instruction.md --model <modelId>
#   -> { agent_id, primary_workspace_id, default_model }
```

This wraps `POST /v1/agent` `{title, kind:"assistant", instruction, create_primary_workspace:true}` and,
if `--model` is given, a follow-up `PATCH` to set `default_model`.

### Modify a live agent

`PATCH /v1/agent/{id}` body **must include `agent_id`** (plus fields to change):

```bash
node .cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js \
  agent-patch <agentId> --instruction-file new_instruction.md
```

### Set the agent's default model

`default_model` is a **model id**, not the display name. Look it up first (ids are account/version-specific),
then set it with `agent-model`:

```bash
node .cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js models
# e.g. minimax-M3 -> pSQrSwQ7e5f7ErseqoHGT, qwen3.5-35B -> X2GyKB3eVGDc3sY6jZZVr  (re-resolve; do not hardcode)
node .cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js agent-model <agentId> <modelId>
```

(`agent-model`/`models` wrap `PATCH /v1/agent/{id}` `{agent_id, default_model}` and
`GET /v1/inference/model/available`.)

`agent-patch --instruction-file` only sends the instruction, so it leaves `default_model` intact.

### Link agents for delegation (multi-agent)

To let a parent agent delegate to a worker via the `delegateToAgent` host tool, create a relation with
`agent-link`:

```bash
node .cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js agent-link <parentId> <workerId>
# wraps POST /v1/agent/<parentId>/relations/batch with relation_type "delegates_to"
# read: req GET /v1/agent/<parentId>/relations -> { items: [...] }
```

`relation_type` `delegates_to` is the UI's «Делегирует задачи» (parent→worker). `POST .../relations`
without `/batch` returns 404. The same skill can be bound to **both** the orchestrator and the worker.

### Delegation / execution limits (BETA «Расширенные настройки»)

The orchestrator's parallelism is capped by **`delegation.max_parallel_runs` (default 4)** — a batch
`delegateToAgents` runs at most `cap` workers at once. Change it (and the join strategy) with `agent-policy`,
which read-before-writes the delegation subtree into **both** `config.policy.delegation` and
`default_policy.agent_modules.delegation` (verified):

```bash
node .cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js \
  agent-policy <agentId> --max-parallel 8 --join-policy wait_all
```

NB: raising the cap alone rarely speeds up a run — `wait_all` waves are gated by the slowest worker, so
per-worker latency dominates. See the `ladcraft-prod-publishing` rule (BETA limits) and the
`ladcraft-agent-drive` skill (orchestration patterns) for the full picture.

### Bind a skill to a live agent

A skill must be **installed into the space first**, otherwise it stays bound-but-"not connected" (`не подключён`) and the agent can't use it. Bind with `--install` to do both:

```bash
node .cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js agent-bind <agentId> <skillAppId> --install
```

This runs `POST /v1/application/space/install/{skillAppId}?type=skill` (→ `installed_application_id`),
then `POST /v1/agent/{id}/apps` with `{agent_id, app_id, enabled}` (`agent_id` required in body).
To install without binding: `skill-install <skillAppId>`.

Verify install took: `GET /v1/application/{skillAppId}?type=skill&return_installed=true` should return
`installed.installed_version`; if the skill is not installed this call errors with `APPLICATION_NOT_FOUND`.

The bind response (`binding_id`, `status: active`) is the proof of binding —
`GET /v1/agent/{id}` does **not** list bindings. Re-binding the same pair is idempotent (returns the same `binding_id`).

### Configure install-time settings (`environment.user`) — verified

A skill that declares `mcp_spec.tools[].environment.user` keys exposes them as an `installationForm`
on the **installed** copy. Set the values with `skill-config` on the **installed application id**
(the `installed_application_id` returned by `skill-install` / `agent-bind --install`):

```bash
node .cursor/skills/ladcraft-prod-publish/scripts/ladcraft_prod.js \
  skill-config <installedAppId> '{"DEV_NAME":"Ануфлий-кун","TOXICITY_LEVEL":"roast"}'
```

This issues `PATCH /v1/application/space/install/{installedAppId}?type=skill` with a **flat**
`{"installationForm":{KEY:value}}` body. At runtime the values arrive as `state.environment.user.KEY`.

- **Do not** use `POST .../space/install/{appId}` (i.e. `skill-install --form`) to set values — it
  does **not** persist them (the install POST is for first-time install only). Use the PATCH above.
- The body is a **flat** `{KEY: value}` map — **not** the nested `{title,value,format}` schema you
  see in the catalog's `installationForm`.
- The id is the **installed** id, not the catalog skill appId.
- GET (catalog or list) **never echoes saved values** (even for other configured skills like secrets),
  so a `null`/absent `value` does **not** mean it failed. The only real verification is a runtime call
  (e.g. run a tool that reads the env and check the output).

---

## Verify

- Skill: `skill-get <appId>` → `status: private`, expected `tools[]`.
- Agent: `agent-get <agentId>` → instruction repointed; bind step returned `status: active`.

## Gotchas (verified)

- A bound skill that was **not installed into the space** shows as "not connected" (`не подключён`). Always install the skill (`agent-bind --install` or `skill-install`) — binding alone is not enough.
- `environment.user` values are set via `skill-config` (`PATCH .../space/install/{installedId}` with a **flat** `{installationForm:{KEY:value}}`), **not** via `skill-install --form` (POST) — the POST install does not persist values. GET never echoes saved values; verify by a runtime tool call.
- Import `application_id` ≠ live `agent_id`; the bundle's embedded `agent_id` is also not live — you must `install`.
- `PATCH /v1/agent/{id}` and `POST /v1/agent/{id}/apps` without `agent_id` in body → `400 VALIDATION_ERROR`.
- Toolkit/SDK default base URL is dev — keep `LADCRAFT_API_URL` set in `.env` (the helper reads it; the KB packager needs it exported).
- Skill memory > 256 or missing `scriptFile` for Python tools blocks publish.
- `skill-update` returns a server-chosen `version` (ignores the one you send) and
  swaps in the new inlined tool `function`s — that's how Python code changes ship.
- After a `skill-update`, a bound agent picks up the new tools/version on its next
  run (re-bind/re-install is not required for a same-id update).
- The skill list endpoint returns `data.applications`, not `data.items`.
- For any undocumented endpoint, capture the web UI's network calls with the
  **chrome-devtools MCP** and replay them with the helper's `req` subcommand.

## Helper subcommands

`auth`, `agent-import`, `agent-install`, `agent-create`, `agent-list`, `agent-get`, `agent-patch`,
`agent-model <agentId> <modelId>`, `models`, `agent-link <parentId> <workerId>`,
`agent-policy <agentId> [--max-parallel N] [--join-policy wait_all|wait_until_timeout] [--join-timeout-ms N] [--resume-parent true|false]`,
`agent-bind [--install]`,
`skill-install`, `skill-config <installedAppId> <form>`, `skill-get`, `skill-create <payload.json>`, `skill-update <appId> <payload.json>`, `req <METHOD> <path> [bodyJsonOrFile]`
(see the header of `scripts/ladcraft_prod.js`).
