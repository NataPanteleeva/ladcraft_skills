"use strict";

const fs = require("fs");
const path = require("path");

async function loadEnv() {
  const envPath = path.join(__dirname, "..", "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
  }
}

async function login(base, email, password) {
  const r = await fetch(base + "/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.toLowerCase(), password }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error("login failed: " + JSON.stringify(d));
  const data = d.data ?? d.result ?? d;
  return data.access_token || data.token;
}

async function api(token, base, method, p, body) {
  const r = await fetch(base + p, {
    method,
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw new Error("HTTP " + r.status + " " + p + " " + JSON.stringify(d));
  return d.data ?? d.result ?? d;
}

async function upload(token, base, fields, localFile) {
  const buf = fs.readFileSync(localFile);
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fd.append("file", new Blob([buf]), path.basename(localFile));
  const r = await fetch(base + "/v1/agent/vfs/upload", {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
    body: fd,
  });
  const d = await r.json();
  if (!r.ok) throw new Error("upload failed: " + JSON.stringify(d));
  return d.data ?? d;
}

async function waitRun(token, base, agentId, sessionId, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const act = await api(token, base, "GET", "/v1/agent/activity?agent_id=" + agentId + "&only_active=true");
    const active = (act.items || []).some((i) => i.session_id === sessionId);
    if (!active) return { done: true, waited_ms: Date.now() - start };
    await new Promise((r) => setTimeout(r, 3000));
  }
  return { done: false, waited_ms: timeoutMs };
}

function summarizeHistory(messages) {
  const assistants = messages.filter((m) => m.role === "assistant");
  const tools = [];
  for (const m of messages) {
    if (!m.tool_calls) continue;
    for (const tc of m.tool_calls) {
      const cmd = (tc.arguments && tc.arguments.command) || tc.command || "";
      tools.push({
        name: tc.name,
        status: tc.status || (tc.success === true ? "completed" : tc.success === false ? "failed" : "unknown"),
        command: String(cmd).slice(0, 120),
      });
    }
  }
  return {
    message_count: messages.length,
    assistant_count: assistants.length,
    last_assistant_preview: assistants.length ? String(assistants[assistants.length - 1].content || "").slice(0, 400) : null,
    has_r7_task: assistants.some((m) => String(m.content || "").includes("r7.task")),
    tool_calls: tools,
    has_bash_ls: tools.some((t) => t.name === "bash" && /Templates/.test(t.command)),
    has_bash_head: tools.some((t) => t.name === "bash" && /head -c/.test(t.command)),
    has_skill_activate: tools.some((t) => t.name === "skills" || /activate/.test(t.name)),
  };
}

async function say(token, base, sessionId, content, file) {
  await api(token, base, "POST", "/v1/agent/session/" + sessionId + "/message", {
    content,
    assistant_mode: "execution",
    mentioned: {
      files: [
        {
          file_id: file.file_id,
          file_name: file.file_name,
          mime_type: "application/json",
        },
      ],
    },
  });
}

async function main() {
  await loadEnv();
  const base = process.env.LADCRAFT_API_URL || "https://api.ladcraft.ru";
  const agentId = process.env.LC_AGENT_ID || "wvccZ9WaZMDdCxfTyDGhh";
  const token = await login(base, process.env.LADCRAFT_EMAIL, process.env.LADCRAFT_PASSWORD);
  const agent = await api(token, base, "GET", "/v1/agent/" + agentId);
  const workspaceId = agent.primary_workspace_id;

  const session = await api(token, base, "POST", "/v1/agent/session", { agent_id: agentId });
  const sessionId = session.session_id;
  const bashPath = "/session/r7/r7-word_smoketest.json";
  const r7Local = path.join(__dirname, "fixtures", "r7-word_smoketest.json");
  const tplLocal = path.join(__dirname, "..", "doc_compare", "workspace", "Templates", "dogovor_postavki.md");

  const r7Up = await upload(token, base, {
    scope: "session",
    session_id: sessionId,
    path: "/r7/r7-word_smoketest.json",
    sync: "true",
  }, r7Local);
  await upload(token, base, {
    scope: "workspace",
    workspace_id: workspaceId,
    path: "Templates/dogovor_postavki.md",
    sync: "true",
  }, tplLocal);

  const file = { file_id: r7Up.file_id, file_name: bashPath };
  const t0 = Date.now();

  await say(token, base, sessionId, "привет", file);
  const wait1 = await waitRun(token, base, agentId, sessionId, 180000);
  const hist1 = await api(token, base, "GET", "/v1/agent/session/" + sessionId + "/history?page=1&size=99999");
  const messages1 = hist1.data || hist1;
  const sum1 = summarizeHistory(messages1);

  let turn2 = null;
  if (sum1.assistant_count > 0) {
    await say(token, base, sessionId, "dogovor_postavki.md", file);
    const wait2 = await waitRun(token, base, agentId, sessionId, 300000);
    const hist2 = await api(token, base, "GET", "/v1/agent/session/" + sessionId + "/history?page=1&size=99999");
    const messages2 = hist2.data || hist2;
    turn2 = { wait: wait2, summary: summarizeHistory(messages2) };
  }

  const result = {
    agent_id: agentId,
    session_id: sessionId,
    elapsed_ms: Date.now() - t0,
    turn1: { wait: wait1, summary: sum1 },
    turn2,
    plugin_like_failure: sum1.assistant_count === 0,
  };

  const out = path.join(__dirname, "smoke_plugin_repro.json");
  fs.writeFileSync(out, JSON.stringify({ ...result, history_turn1: messages1 }, null, 2));
  console.log(JSON.stringify(result, null, 2));
  process.exit(sum1.assistant_count > 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
