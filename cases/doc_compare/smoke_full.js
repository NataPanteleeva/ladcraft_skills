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

async function upload(token, base, fields, localFile) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fd.append("sync", "true");
  fd.append("file", new Blob([fs.readFileSync(localFile)]), path.basename(localFile));
  const r = await fetch(base + "/v1/agent/vfs/upload", {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
    body: fd,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(d));
  return d.data ?? d;
}

async function waitRun(token, base, agentId, sessionId, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const act = await api(token, base, "GET", "/v1/agent/activity?agent_id=" + agentId + "&only_active=true");
    const active = (act.items || []).some((i) => i.session_id === sessionId);
    if (!active) return { done: true, waited_ms: Date.now() - start };
    await new Promise((r) => setTimeout(r, 5000));
  }
  return { done: false, waited_ms: timeoutMs };
}

function toolSummary(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role !== "assistant" || !m.tool_calls) continue;
    for (const tc of m.tool_calls) {
      out.push({ name: tc.name, command: tc.command || "" });
    }
  }
  return out;
}

function lastAssistantContent(messages) {
  const assistants = messages.filter((m) => m.role === "assistant");
  const last = assistants[assistants.length - 1];
  return last && last.content ? last.content : "";
}

async function main() {
  await loadEnv();
  const base = process.env.LADCRAFT_API_URL || "https://api.ladcraft.ru";
  const agentId = "mwCvjRFNfMsFInbLjrrdr";
  const token = await login(base, process.env.LADCRAFT_EMAIL, process.env.LADCRAFT_PASSWORD);
  const agent = await api(token, base, "GET", "/v1/agent/" + agentId);
  const workspaceId = agent.primary_workspace_id;
  const session = await api(token, base, "POST", "/v1/agent/session", { agent_id: agentId });
  const sessionId = session.session_id;
  const bashPath = "/session/r7/r7-word_smoketest.json";

  const r7Up = await upload(
    token,
    base,
    { scope: "session", session_id: sessionId, path: "/r7/r7-word_smoketest.json" },
    path.join(__dirname, "..", "compare-r7", "fixtures", "r7-word_smoketest.json")
  );
  await upload(
    token,
    base,
    { scope: "workspace", workspace_id: workspaceId, path: "temp.md" },
    path.join(__dirname, "workspace", "temp.md")
  );
  await upload(
    token,
    base,
    { scope: "workspace", workspace_id: workspaceId, path: "Templates/dogovor_postavki.md" },
    path.join(__dirname, "workspace", "Templates", "dogovor_postavki.md")
  );

  const mentioned = {
    files: [{ file_id: r7Up.file_id, file_name: bashPath, mime_type: "application/json" }],
  };

  const t0 = Date.now();
  await api(token, base, "POST", "/v1/agent/session/" + sessionId + "/message", {
    content: "Сравни документ с шаблоном",
    assistant_mode: "execution",
    mentioned,
  });
  const wait1 = await waitRun(token, base, agentId, sessionId, 180000);
  let hist = await api(token, base, "GET", "/v1/agent/session/" + sessionId + "/history?page=1&size=50");
  const msgs1 = hist.data || hist;
  const tools1 = toolSummary(msgs1);
  const content1 = lastAssistantContent(msgs1);

  await api(token, base, "POST", "/v1/agent/session/" + sessionId + "/message", {
    content: "dogovor_postavki.md",
    assistant_mode: "execution",
    mentioned,
  });
  const wait2 = await waitRun(token, base, agentId, sessionId, 180000);
  hist = await api(token, base, "GET", "/v1/agent/session/" + sessionId + "/history?page=1&size=100");
  const msgs2 = hist.data || hist;
  const tools2 = toolSummary(msgs2);
  const content2 = lastAssistantContent(msgs2);

  const cmds1 = tools1.map((t) => t.command).join(" ");
  const cmdsAll = tools2.map((t) => t.command).join(" ");

  const step1Ok =
    wait1.done &&
    !tools1.some((t) => t.name === "bash") &&
    cmds1.includes("doc_compare_toolkit") &&
    cmds1.includes("resolve_r7_document") &&
    cmds1.includes("list_templates") &&
    /шаблон|Templates|dogovor/i.test(content1);

  const step2Ok =
    wait2.done &&
    cmdsAll.includes("compare_with_template") &&
    !cmdsAll.includes("startup_compare") &&
    !cmdsAll.includes("doc-compare") &&
    /Отчёт о сравнении|расхожден/i.test(content2) &&
    /вставить|скачать/i.test(content2);

  const ok = step1Ok && step2Ok;

  console.log(
    JSON.stringify(
      {
        ok,
        session_id: sessionId,
        elapsed_ms: Date.now() - t0,
        step1: { ok: step1Ok, waited_ms: wait1.waited_ms, tool_calls: tools1, content_preview: content1.slice(0, 350) },
        step2: { ok: step2Ok, waited_ms: wait2.waited_ms, tool_calls: tools2.slice(-5), content_preview: content2.slice(0, 500) },
      },
      null,
      2
    )
  );
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("SMOKE FAILED:", e.message);
  process.exit(1);
});
