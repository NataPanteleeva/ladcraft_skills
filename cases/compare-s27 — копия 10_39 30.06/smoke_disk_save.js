"use strict";

const fs = require("fs");
const path = require("path");

const AGENT_ID = process.env.LC_AGENT_ID || "s_eDSWr8EkRPfDsbgBJxa";
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
        msg: contentPreview(m.content),
        name: tc.name,
        command: tc.command || "",
        arguments: tc.arguments,
        status: tc.status,
        result: typeof tc.result === "string" ? tc.result.slice(0, 500) : tc.result,
        content: typeof tc.content === "string" ? tc.content.slice(0, 300) : "",
      });
    }
  }
  return out;
}

function contentPreview(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function lastAssistant(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "assistant") return messages[i];
  }
  return null;
}

function findAssistantAfterUser(messages, userText) {
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i];
    if (m.role === "user" && String(m.content || "").trim() === userText) {
      for (let j = i + 1; j < messages.length; j += 1) {
        if (messages[j].role === "assistant") return messages[j];
      }
    }
  }
  return null;
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
  const t0 = Date.now();

  steps.push({ turn: "start", ...(await say(token, base, AGENT_ID, sessionId, "привет", mentioned)) });
  steps.push({
    turn: "compare",
    ...(await say(token, base, AGENT_ID, sessionId, "dogovor_postavki.md", mentioned)),
  });
  steps.push({
    turn: "disk_save",
    ...(await say(token, base, AGENT_ID, sessionId, "сохранить на диск", mentioned)),
  });

  const hist = await api(token, base, "GET", "/v1/agent/session/" + sessionId + "/history?page=1&size=50");
  const messages = hist.data || hist;
  const tools = flattenTools(messages);
  const compareMsg = findAssistantAfterUser(messages, "dogovor_postavki.md");
  const diskMsg = findAssistantAfterUser(messages, "сохранить на диск");

  const compareTools = (compareMsg && compareMsg.tool_calls) || [];
  const compareBash = compareTools.filter((t) => t.name === "bash").length;

  const diskTools = (diskMsg && diskMsg.tool_calls) || [];
  const saveTool = diskTools.find(
    (t) =>
      t.name === "r7_save_compare_report_to_disk" ||
      String(t.name || "").includes("r7_save_compare")
  );
  const activateDisk = diskTools.some(
    (t) =>
      String(t.command || "").includes("r7-save-compare-disk-s27") ||
      String(t.content || "").includes("r7-save-compare-disk-s27")
  );
  const denied = tools.some((t) => /allowed_app_ids catalog/i.test(String(t.content || t.result || "")));
  const diskContent = (diskMsg && diskMsg.content) || "";
  const hasR7Task = /```r7\.task|r7\.task/.test(diskContent);

  let saveOk = false;
  let saveFolder = "";
  let saveFile = "";
  if (saveTool && saveTool.result) {
    try {
      const parsed = typeof saveTool.result === "string" ? JSON.parse(saveTool.result) : saveTool.result;
      saveOk = parsed && parsed.ok === true;
      saveFolder = parsed && parsed.folder_name ? parsed.folder_name : "";
      saveFile = parsed && parsed.file_name ? parsed.file_name : "";
    } catch {
      saveOk = /"ok"\s*:\s*true/.test(String(saveTool.result));
    }
  }

  const ok =
    steps.every((s) => s.done) &&
    compareMsg &&
    /Результаты сравнения|Расхождений/i.test(compareMsg.content || "") &&
    compareBash === 2 &&
    diskMsg &&
    !denied &&
    !hasR7Task &&
    (saveTool || activateDisk) &&
    (saveOk || (saveTool && saveTool.status === "completed"));

  const outPath = path.join(__dirname, "_smoke_disk_save.json");
  const result = {
    ok,
    agent_id: AGENT_ID,
    session_id: sessionId,
    elapsed_ms: Date.now() - t0,
    steps,
    checks: {
      compare_report: Boolean(compareMsg && /Расхождений/i.test(compareMsg.content || "")),
      compare_two_bash: compareBash === 2,
      disk_no_denied: !denied,
      disk_save_tool: Boolean(saveTool),
      disk_save_ok: saveOk,
      disk_folder_compare_results: saveFolder === "CompareResults" || !saveFolder,
      disk_file_docx: !saveFile || saveFile.toLowerCase().endsWith(".docx"),
      disk_no_r7_task: !hasR7Task,
    },
    disk_content_tail: diskContent.slice(-500),
    save_tool_result: saveTool ? saveTool.result : null,
    tools,
  };
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
