"use strict";

// Ladcraft AGENT CHAT/RUNTIME driver (data plane), Node >=18, no external deps.
// Drives a *live* agent programmatically: create session -> upload file(s) ->
// send message -> poll activity -> fetch full history (tool calls + results).
//
// This is the runtime/chat API, distinct from the control plane (publish/bind),
// which lives in the `ladcraft-prod-publish` skill. Endpoints were verified by
// capturing the web UI's network traffic with the chrome-devtools MCP.
//
// Credentials/env (per key: process.env, then .env in CWD):
//   LADCRAFT_EMAIL (fallback LADCRAFT_USERNAME), LADCRAFT_PASSWORD,
//   LADCRAFT_API_URL (default https://api.ladcraft.ru), LADCRAFT_ENV_FILE (default ./.env)
//   LC_AGENT_ID  (live agent_id; or pass --agent <id>)
//
// Usage:
//   node lc_agent_drive.js auth
//   node lc_agent_drive.js session-create --agent <agentId>
//   node lc_agent_drive.js upload-workspace <workspaceId> <localFile> [destPath]  # upload a file into /workspace (e.g. KB)
//   node lc_agent_drive.js launch <file> [--agent <id>] [--msg "..."]            # session+upload+message
//   node lc_agent_drive.js say <sessionId> --msg "..."                            # send a message to an EXISTING session (also answers a requestUserInput/requestApproval question)
//   node lc_agent_drive.js active [--agent <id>]                                  # only-active runs
//   node lc_agent_drive.js history <sessionId> [--out file.json]
//   node lc_agent_drive.js vfs-list <scope> [--workspace|--session|--space <id>] [--path P] [--hierarchical]
//   node lc_agent_drive.js vfs-delete <scope> <path> [--workspace <id>]          # delete file OR folder (no body)
//   node lc_agent_drive.js vfs-quota <scope> [--workspace <id>]                  # scope=workspace|space
//   node lc_agent_drive.js run <file> [--agent <id>] [--msg "..."] \             # launch, poll to idle, dump
//        [--out file.json] [--timeout-ms 600000] [--interval-ms 10000]
//
// Notes:
// - In a browser, the same endpoints require `credentials: 'include'` (cookie auth);
//   from a script use the Bearer token from /v1/auth/login.
// - History shape: { data: [ { role, content, tool_calls: [ { name, command|arguments, result, status } ] } ] }.

const fs = require("fs");
const path = require("path");

function loadDotEnv() {
  const file = process.env.LADCRAFT_ENV_FILE || path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}

// Load .env BEFORE resolving the base URL so LADCRAFT_API_URL from .env is honored.
loadDotEnv();
const BASE = (process.env.LADCRAFT_API_URL || "https://api.ladcraft.ru").replace(/\/$/, "");

const unwrap = (d) => (d && typeof d === "object" && d.result !== undefined ? d.result : d);

function flag(args, name) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

function resolveAgent(args) {
  const id = flag(args, "--agent") || process.env.LC_AGENT_ID;
  if (!id) throw new Error("Missing agent id (pass --agent <id> or set LC_AGENT_ID)");
  return id;
}

async function api(token, method, p, { body, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const init = { method, headers };
  if (raw) init.body = raw;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const r = await fetch(BASE + p, init);
  const ct = r.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await r.json() : await r.text();
  if (!r.ok) {
    const e = new Error(`HTTP ${r.status} ${method} ${p}`);
    e.data = data;
    throw e;
  }
  return data;
}

async function login() {
  loadDotEnv();
  const email = (process.env.LADCRAFT_EMAIL || process.env.LADCRAFT_USERNAME || "").toLowerCase();
  const password = process.env.LADCRAFT_PASSWORD;
  if (!email || !password) throw new Error("Missing LADCRAFT_EMAIL/USERNAME or LADCRAFT_PASSWORD");
  const d = unwrap(await api(null, "POST", "/v1/auth/login", { body: { email, password } }));
  const token = d.access_token || d.token;
  if (!token) throw new Error("No access_token in login response");
  return token;
}

async function createSession(token, agentId) {
  const d = unwrap(await api(token, "POST", "/v1/agent/session", { body: { agent_id: agentId } }));
  return d.session_id;
}

// Multipart upload to the agent VFS. scope=session keeps the file in /session/.
async function uploadFile(token, sessionId, filePath) {
  const buf = fs.readFileSync(filePath);
  const fd = new FormData();
  fd.append("scope", "session");
  fd.append("session_id", sessionId);
  fd.append("sync", "true");
  fd.append("file", new Blob([buf]), path.basename(filePath));
  const r = await fetch(BASE + "/v1/agent/vfs/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  const d = await r.json();
  if (!r.ok) {
    const e = new Error(`HTTP ${r.status} upload`);
    e.data = d;
    throw e;
  }
  return unwrap(d);
}

// Upload a file into the agent's /workspace (visible in "Файлы агента"; the KB / fileSearch index).
// destPath is the full path within the scope, e.g. "methodology/triage_spec.json".
async function uploadWorkspaceFile(token, workspaceId, filePath, destPath) {
  const buf = fs.readFileSync(filePath);
  const fd = new FormData();
  fd.append("scope", "workspace");
  fd.append("workspace_id", workspaceId);
  fd.append("path", destPath || path.basename(filePath));
  fd.append("sync", "true");
  fd.append("file", new Blob([buf]), path.basename(filePath));
  const r = await fetch(BASE + "/v1/agent/vfs/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  const d = await r.json();
  if (!r.ok) {
    const e = new Error(`HTTP ${r.status} upload-workspace`);
    e.data = d;
    throw e;
  }
  return unwrap(d);
}

async function sendMessage(token, sessionId, content, attached) {
  const body = { content, assistant_mode: "execution" };
  if (attached && attached.length) body.files = { attached };
  return unwrap(await api(token, "POST", `/v1/agent/session/${sessionId}/message`, { body }));
}

async function activeRuns(token, agentId) {
  return unwrap(await api(token, "GET", `/v1/agent/activity?agent_id=${agentId}&only_active=true`));
}

async function history(token, sessionId) {
  return unwrap(await api(token, "GET", `/v1/agent/session/${sessionId}/history?page=1&size=99999`));
}

// Scope-id flag/query for VFS endpoints: workspace/session/space need their id; user needs none.
function vfsScopeQuery(scope, args) {
  if (scope === "workspace") {
    const id = flag(args, "--workspace") || process.env.LC_WORKSPACE_ID;
    if (!id) throw new Error("scope=workspace needs --workspace <workspaceId> (or LC_WORKSPACE_ID)");
    return `&workspace_id=${encodeURIComponent(id)}`;
  }
  if (scope === "session") {
    const id = flag(args, "--session");
    if (!id) throw new Error("scope=session needs --session <sessionId>");
    return `&session_id=${encodeURIComponent(id)}`;
  }
  if (scope === "space") {
    const id = flag(args, "--space");
    return id ? `&space_id=${encodeURIComponent(id)}` : "";
  }
  return ""; // user
}

async function vfsList(token, scope, args) {
  const hierarchical = args.includes("--hierarchical");
  const p = flag(args, "--path");
  let q = `scope=${scope}${vfsScopeQuery(scope, args)}&page=1&size=9999&hierarchical=${hierarchical}`;
  if (p) q += `&path=${encodeURIComponent(p)}`;
  return unwrap(await api(token, "GET", `/v1/agent/vfs/files?${q}`));
}

// Delete a file OR folder (single endpoint; send NO body). path is the full ~/scope/... path.
async function vfsDelete(token, scope, p, args) {
  const q = `scope=${scope}${vfsScopeQuery(scope, args)}&path=${encodeURIComponent(p)}`;
  return unwrap(await api(token, "DELETE", `/v1/agent/vfs/folders?${q}`));
}

async function vfsQuota(token, scope, args) {
  if (scope === "user") throw new Error("vfs-quota rejects scope=user; use workspace|space");
  const q = `scope=${scope}${vfsScopeQuery(scope, args)}`;
  return unwrap(await api(token, "GET", `/v1/agent/vfs/quota?${q}`));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(token, agentId, filePath, msg) {
  const sid = await createSession(token, agentId);
  let attached;
  let fileName;
  if (filePath) {
    const up = await uploadFile(token, sid, filePath);
    fileName = path.basename(filePath);
    attached = [{ file_id: up.file_id, file_name: fileName }];
  }
  const sent = await sendMessage(token, sid, msg || "выполни задачу", attached);
  return { session_id: sid, file: fileName, ...sent };
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd) throw new Error("Specify a subcommand (see header of this file)");

  if (cmd === "auth") {
    await login();
    return { ok: true, base_url: BASE };
  }

  const token = await login();

  switch (cmd) {
    case "session-create": {
      const sid = await createSession(token, resolveAgent(args));
      return { ok: true, session_id: sid };
    }
    case "upload-workspace": {
      const workspaceId = args[0];
      const file = args[1];
      const destPath = args[2];
      if (!workspaceId || !file) throw new Error("upload-workspace <workspaceId> <localFile> [destPath]");
      const up = await uploadWorkspaceFile(token, workspaceId, file, destPath);
      return { ok: true, ...up };
    }
    case "launch": {
      const file = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
      return { ok: true, ...(await launch(token, resolveAgent(args), file, flag(args, "--msg"))) };
    }
    case "say": {
      // Send a message to an EXISTING session. When the session is in
      // waiting_user_response (a requestUserInput/requestApproval question),
      // this same call delivers the answer: the runtime correlates the plain
      // message with the pending action and resumes the SAME task_id (new run_id).
      const sid = args[0];
      const msg = flag(args, "--msg");
      if (!sid || !msg) throw new Error("say <sessionId> --msg \"...\"");
      const sent = await sendMessage(token, sid, msg);
      return { ok: true, session_id: sid, ...sent };
    }
    case "active": {
      return { ok: true, ...(await activeRuns(token, resolveAgent(args))) };
    }
    case "history": {
      const sid = args[0];
      if (!sid) throw new Error("history <sessionId> [--out file.json]");
      const h = await history(token, sid);
      const out = flag(args, "--out") || `/tmp/lc_history_${sid}.json`;
      fs.writeFileSync(out, JSON.stringify(h, null, 2));
      return { ok: true, out, count: (h.data || []).length };
    }
    case "vfs-list": {
      const scope = args[0];
      if (!scope) throw new Error("vfs-list <scope> [--workspace|--session|--space <id>] [--path P] [--hierarchical]");
      const d = await vfsList(token, scope, args);
      let items = d?.data?.data || d?.data || d;
      if (!Array.isArray(items)) items = items?.data || [];
      return { ok: true, scope, count: items.length, items: items.map((x) => ({ name: x.file_name, path: x.file_path || x.path, size: x.size_bytes })) };
    }
    case "vfs-delete": {
      const scope = args[0];
      const p = args[1];
      if (!scope || !p) throw new Error("vfs-delete <scope> <path> [--workspace <id>]");
      return { ok: true, ...(await vfsDelete(token, scope, p, args)) };
    }
    case "vfs-quota": {
      const scope = args[0];
      if (!scope) throw new Error("vfs-quota <scope> [--workspace <id>]");
      return { ok: true, scope, ...(await vfsQuota(token, scope, args)) };
    }
    case "run": {
      const agentId = resolveAgent(args);
      const file = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
      const timeoutMs = Number(flag(args, "--timeout-ms") || 600000);
      const intervalMs = Number(flag(args, "--interval-ms") || 10000);
      const launched = await launch(token, agentId, file, flag(args, "--msg"));
      const sid = launched.session_id;
      const deadline = Date.now() + timeoutMs;
      let lastState = "working";
      while (Date.now() < deadline) {
        await sleep(intervalMs);
        const a = await activeRuns(token, agentId);
        const mine = (a.items || []).find((i) => i.session_id === sid);
        if (!mine) {
          lastState = "idle";
          break;
        }
        lastState = mine.activity_state;
      }
      const h = await history(token, sid);
      const out = flag(args, "--out") || `/tmp/lc_history_${sid}.json`;
      fs.writeFileSync(out, JSON.stringify(h, null, 2));
      return { ok: true, session_id: sid, final_state: lastState, out, count: (h.data || []).length };
    }
    default:
      throw new Error(`Unknown subcommand: ${cmd}`);
  }
}

main()
  .then((out) => process.stdout.write(JSON.stringify(out, null, 2) + "\n"))
  .catch((e) => {
    process.stderr.write(`FAILED: ${e.message}\n` + (e.data ? JSON.stringify(e.data, null, 2) + "\n" : (e.stack || "") + "\n"));
    process.exit(1);
  });
