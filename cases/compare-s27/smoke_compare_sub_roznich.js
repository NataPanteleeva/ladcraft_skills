"use strict";

const fs = require("fs");
const path = require("path");

const AGENT_ID = process.env.LC_AGENT_ID || "ju4MekTiV4psav71nudMI";
const ROOT = path.join(__dirname, "..", "..");

async function loadEnv() {
  const envPath = path.join(ROOT, ".env");
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

async function say(token, base, agentId, sessionId, content, mentioned) {
  await api(token, base, "POST", "/v1/agent/session/" + sessionId + "/message", {
    content,
    assistant_mode: "execution",
    ...(mentioned ? { mentioned } : {}),
  });
  return waitRun(token, base, agentId, sessionId, 240000);
}

function flattenTools(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role !== "assistant" || !m.tool_calls) continue;
    for (const tc of m.tool_calls) {
      out.push({
        name: tc.name,
        command: tc.command || "",
        status: tc.status,
      });
    }
  }
  return out;
}

async function main() {
  await loadEnv();
  const base = process.env.LADCRAFT_API_URL || "https://api.ladcraft.ru";
  const token = await login(base, process.env.LADCRAFT_EMAIL, process.env.LADCRAFT_PASSWORD);

  const session = await api(token, base, "POST", "/v1/agent/session", { agent_id: AGENT_ID });
  const sessionId = session.session_id;
  const vfsPath = "/session/r7/r7-word_smoketest.json";
  const fixture =
    process.env.SMOKE_R7_FIXTURE ||
    path.join(__dirname, "..", "compare-r7_v2", "fixtures", "r7-word_smoketest.json");
  if (!fs.existsSync(fixture)) throw new Error("Fixture not found: " + fixture);

  const r7Up = await uploadSessionPath(token, base, sessionId, "/r7/r7-word_smoketest.json", fixture);
  const mentioned = {
    files: [{ file_id: r7Up.file_id, file_name: vfsPath, mime_type: "application/json" }],
  };

  const t0 = Date.now();
  const steps = [];
  steps.push({ turn: "start", ...(await say(token, base, AGENT_ID, sessionId, "привет", mentioned)) });
  steps.push({
    turn: "compare",
    ...(await say(token, base, AGENT_ID, sessionId, "sub_roznich.md", mentioned)),
  });

  const hist = await api(token, base, "GET", "/v1/agent/session/" + sessionId + "/history?page=1&size=50");
  const messages = hist.data || hist;
  const tools = flattenTools(messages);
  const compareMsg = messages.find(
    (m, i) => m.role === "assistant" && messages[i - 1] && messages[i - 1].content === "sub_roznich.md"
  );
  const compareTools = (compareMsg && compareMsg.tool_calls) || [];
  const compareBash = compareTools.filter((t) => t.name === "bash");
  const hasForbiddenAfter = compareBash.some((t) =>
    /ls\s|find\s|wc\s|grep\s|python/.test(String(t.command || ""))
  );
  const content = (compareMsg && compareMsg.content) || "";
  const failureAck = /snapshot.*не в сессии|snapshot.*недоступен|переприкрепите/i.test(content);

  const ok =
    steps.every((s) => s.done) &&
    compareMsg &&
    /Результаты сравнения|Расхождений/i.test(content) &&
    compareBash.length === 2 &&
    !hasForbiddenAfter &&
    !failureAck;

  const result = {
    ok,
    agent_id: AGENT_ID,
    session_id: sessionId,
    elapsed_ms: Date.now() - t0,
    steps,
    checks: {
      compare_report: /Расхождений/i.test(content),
      compare_two_bash: compareBash.length === 2,
      compare_no_diagnostic_spiral: !hasForbiddenAfter,
      compare_no_failure_ack: !failureAck,
    },
    compare_bash_commands: compareBash.map((t) => t.command),
    content_preview: content.slice(0, 500),
    tools,
  };
  const outPath = path.join(__dirname, "_smoke_compare_sub_roznich.json");
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
