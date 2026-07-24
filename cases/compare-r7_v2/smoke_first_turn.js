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

async function uploadSessionPath(token, base, sessionId, vfsPath, localFile) {
  const buf = fs.readFileSync(localFile);
  const fd = new FormData();
  fd.append("scope", "session");
  fd.append("session_id", sessionId);
  fd.append("path", vfsPath);
  fd.append("sync", "true");
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

function readAgentId() {
  const metaPath = path.join(__dirname, "agent", ".from-server.json");
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      if (meta.agentId) return meta.agentId;
    } catch {
      /* ignore */
    }
  }
  return process.env.LC_AGENT_ID || "tc04UdOHJpv0YYKJjLbF8";
}

async function main() {
  await loadEnv();
  const base = process.env.LADCRAFT_API_URL || "https://api.ladcraft.ru";
  const agentId = readAgentId();
  const token = await login(base, process.env.LADCRAFT_EMAIL, process.env.LADCRAFT_PASSWORD);
  const session = await api(token, base, "POST", "/v1/agent/session", { agent_id: agentId });
  const sessionId = session.session_id;
  const bashPath = "/session/r7/r7-word_smoketest.json";
  const r7Local = path.join(__dirname, "fixtures", "r7-word_smoketest.json");
  const r7Up = await uploadSessionPath(token, base, sessionId, "/r7/r7-word_smoketest.json", r7Local);
  const t0 = Date.now();
  await api(token, base, "POST", "/v1/agent/session/" + sessionId + "/message", {
    content: "Привет",
    assistant_mode: "execution",
    mentioned: {
      files: [{ file_id: r7Up.file_id, file_name: bashPath, mime_type: "application/json" }],
    },
  });
  const wait = await waitRun(token, base, agentId, sessionId, 120000);
  const hist = await api(token, base, "GET", "/v1/agent/session/" + sessionId + "/history?page=1&size=50");
  const messages = hist.data || hist;
  const assistant = messages.find((m) => m.role === "assistant");
  const tools = [];
  if (assistant && assistant.tool_calls) {
    for (const tc of assistant.tool_calls) {
      tools.push({
        name: tc.name,
        command: tc.command || (tc.arguments && tc.arguments.command) || "",
        status: tc.status,
      });
    }
  }
  const bashCalls = tools.filter((t) => t.name === "bash");
  const hasLs = bashCalls.some((t) => String(t.command).includes("ls") && String(t.command).includes("Templates"));
  const hasPeekB = bashCalls.some((t) => String(t.command).includes("head") && String(t.command).includes("/session/r7/"));
  const hasActivate = tools.some(
    (t) =>
      t.name === "skills activate" ||
      String(t.name).includes("activate") ||
      (t.name === "skills" && /r7-document-compare|doc-compare|compare-toolkit/.test(String(t.command)))
  );
  const hasForbidden =
    tools.some((t) => t.name === "startup_compare" || t.name === "read_r7_snapshot_text") ||
    bashCalls.some((t) => /python|find|startup_compare/.test(String(t.command))) ||
    hasPeekB;
  const toolCount = tools.length;
  const content = assistant && assistant.content ? assistant.content : "";
  const hasTemplateList = /Шаблоны:|шаблон/i.test(content) || /\d+\.\s*.+\.md/.test(content);
  const ok = hasLs && hasActivate && !hasForbidden && toolCount <= 2 && wait.done && hasTemplateList;
  console.log(
    JSON.stringify(
      {
        ok,
        agent_id: agentId,
        session_id: sessionId,
        waited_ms: wait.waited_ms,
        elapsed_ms: Date.now() - t0,
        checks: { hasLs, hasActivate, hasPeekB, hasForbidden, toolCount, hasTemplateList },
        tool_calls: tools,
        content_preview: content.slice(0, 400),
      },
      null,
      2
    )
  );
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
