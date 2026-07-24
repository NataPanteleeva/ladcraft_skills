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
      out.push({ name: tc.name, command: tc.command || "", status: tc.status });
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

  const steps = [];
  steps.push({ turn: "start", ...(await say(token, base, AGENT_ID, sessionId, "привет", mentioned)) });
  steps.push({
    turn: "compare",
    ...(await say(token, base, AGENT_ID, sessionId, "dogovor_postavki.md", mentioned)),
  });
  steps.push({
    turn: "docx",
    ...(await say(token, base, AGENT_ID, sessionId, "скачать docx", mentioned)),
  });

  const hist = await api(token, base, "GET", "/v1/agent/session/" + sessionId + "/history?page=1&size=50");
  const messages = hist.data || hist;
  const tools = flattenTools(messages);
  const docxMsg = messages.find(
    (m, i) => m.role === "assistant" && messages[i - 1] && messages[i - 1].content === "скачать docx"
  );
  const docxTools = (docxMsg && docxMsg.tool_calls) || [];
  const hasRender = docxTools.some((t) => t.name === "r7_render_docx");
  const hasDiskSave = docxTools.some((t) => t.name === "r7_save_compare_report_to_disk");
  const hasDeliver = docxTools.some((t) => t.name === "r7_deliver_docx");
  const hasRecompare = docxTools.some((t) => t.name === "bash");
  const content = (docxMsg && docxMsg.content) || "";
  const fakeTask = /download_docx|r7\.task.*deliver_file/i.test(content);
  const diskOk = /CompareResults|Р7-Диск|сохранён/i.test(content);

  const ok =
    steps.every((s) => s.done) &&
    docxMsg &&
    hasRender &&
    hasDiskSave &&
    !hasDeliver &&
    !hasRecompare &&
    !fakeTask &&
    diskOk;

  const result = {
    ok,
    agent_id: AGENT_ID,
    session_id: sessionId,
    checks: {
      render: hasRender,
      disk_save: hasDiskSave,
      no_deliver_docx: !hasDeliver,
      no_recompare_bash: !hasRecompare,
      no_fake_r7_task: !fakeTask,
      disk_message: diskOk,
    },
    content_preview: content.slice(0, 500),
    docx_tools: docxTools.map((t) => ({ name: t.name, command: t.command })),
    tools,
  };
  const outPath = path.join(__dirname, "_smoke_docx_disk.json");
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
