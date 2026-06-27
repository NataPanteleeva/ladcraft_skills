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

async function main() {
  await loadEnv();
  const base = process.env.LADCRAFT_API_URL || "https://api.ladcraft.ru";
  const agentId = process.env.LC_AGENT_ID || "mwCvjRFNfMsFInbLjrrdr";
  const token = await login(base, process.env.LADCRAFT_EMAIL, process.env.LADCRAFT_PASSWORD);
  const session = await api(token, base, "POST", "/v1/agent/session", { agent_id: agentId });
  const sessionId = session.session_id;
  const bashPath = "/session/r7/r7-word_smoketest.json";
  const r7Local = path.join(__dirname, "fixtures", "r7-word_smoketest.json");
  const r7Up = await uploadSessionPath(token, base, sessionId, "/r7/r7-word_smoketest.json", r7Local);
  const t0 = Date.now();
  await api(token, base, "POST", "/v1/agent/session/" + sessionId + "/message", {
    content: "Сравни документ с шаблоном",
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
      tools.push({ name: tc.name, command: tc.command || "" });
    }
  }
  const names = tools.map((t) => t.name);
  const hasStartup = tools.some((t) => (t.command || "").includes("startup_compare"));
  const hasBash = names.includes("bash");
  const ok = hasStartup && !hasBash && wait.done;
  console.log(
    JSON.stringify(
      {
        ok,
        session_id: sessionId,
        waited_ms: wait.waited_ms,
        elapsed_ms: Date.now() - t0,
        tool_calls: tools,
        content_preview: (assistant && assistant.content ? assistant.content : "").slice(0, 300),
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
