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
  return waitRun(token, base, agentId, sessionId, 180000);
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
        result: tc.result,
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

const POST_READ_RE =
  /\b(ls|find|wc|python3|stat)\b|\.tool_results|cat\s+["']\/session\/r7\//i;

function toolResultHasSnapshot(result) {
  if (result == null) return false;
  if (typeof result === "object") {
    return result.schema === "r7-snapshot/v1";
  }
  return String(result).includes("r7-snapshot/v1");
}

function analyzeCompareTurn(compareMsg) {
  const tools = (compareMsg && compareMsg.tool_calls) || [];
  const bashTools = tools.filter((t) => t.name === "bash");
  const postRead = bashTools.slice(2).filter((t) => POST_READ_RE.test(String(t.command || "")));
  const headB = bashTools.find((t) => String(t.command || "").includes("/session/r7/"));
  const headHasSnapshot = Boolean(headB && toolResultHasSnapshot(headB.result));
  const content = String((compareMsg && compareMsg.content) || "");
  return {
    compareToolCount: tools.length,
    compareBash: bashTools.length,
    comparePostReadCount: postRead.length,
    compareNoPostRead: tools.length === 2 && bashTools.length === 2 && postRead.length === 0,
    compareHeadHasSnapshot: headHasSnapshot,
    compareHasResultsHeader: /##\s*Результаты сравнения/i.test(content),
    compareHasDiscrepancyCount: /Расхождений:\s*\d+/i.test(content),
    compareIterations: compareMsg && compareMsg.iterations,
    comparePostReadCommands: postRead.map((t) => t.command),
  };
}

function lastAssistant(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "assistant") return messages[i];
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
  steps.push({ turn: "download", ...(await say(token, base, AGENT_ID, sessionId, "скачать", mentioned)) });

  const hist = await api(token, base, "GET", "/v1/agent/session/" + sessionId + "/history?page=1&size=50");
  const messages = hist.data || hist;
  const tools = flattenTools(messages);
  const compareMsg = messages.find(
    (m, i) => m.role === "assistant" && messages[i - 1] && messages[i - 1].content === "dogovor_postavki.md"
  );
  const downloadMsg = lastAssistant(messages);

  const compareTools = (compareMsg && compareMsg.tool_calls) || [];
  const compareAnalysis = analyzeCompareTurn(compareMsg);
  const compareBash = compareAnalysis.compareBash;
  const compareSkills = compareTools.some((t) => t.name === "skills" || String(t.command || "").includes("activate"));

  const downloadTools = (downloadMsg && downloadMsg.tool_calls) || [];
  const activateReport = downloadTools.some(
    (t) =>
      String(t.command || "").includes("r7-report-actions-s27") ||
      String(t.content || "").includes("r7-report-actions-s27")
  );
  const activateExportWrong = downloadTools.some((t) =>
    String(t.command || "").includes("r7-export-compare-s27")
  );
  const prepareTool = downloadTools.some(
    (t) => t.name === "r7_prepare_report_actions" || String(t.name || "").includes("r7_prepare")
  );
  const denied = tools.some((t) => /allowed_app_ids catalog/i.test(String(t.content || t.result || "")));
  const downloadContent = (downloadMsg && downloadMsg.content) || "";
  const hasR7Task = /```r7\.task|r7\.task/.test(downloadContent);
  const bashFallback = downloadTools.some((t) => String(t.command || "").includes(".tool_results"));

  const ok =
    steps.every((s) => s.done) &&
    compareMsg &&
    compareAnalysis.compareHasDiscrepancyCount &&
    compareAnalysis.compareHasResultsHeader &&
    compareBash === 2 &&
    compareAnalysis.compareNoPostRead &&
    compareAnalysis.compareHeadHasSnapshot &&
    !compareSkills &&
    downloadMsg &&
    !denied &&
    !activateExportWrong &&
    !bashFallback &&
    (prepareTool || hasR7Task);

  const outPath = path.join(__dirname, "_smoke_download.json");
  const result = {
    ok,
    agent_id: AGENT_ID,
    session_id: sessionId,
    elapsed_ms: Date.now() - t0,
    steps,
    checks: {
      compare_report: compareAnalysis.compareHasDiscrepancyCount,
      compare_results_header: compareAnalysis.compareHasResultsHeader,
      compare_two_bash: compareBash === 2,
      compare_no_post_read: compareAnalysis.compareNoPostRead,
      compare_head_has_snapshot: compareAnalysis.compareHeadHasSnapshot,
      compare_no_skill_activate: !compareSkills,
      compare_iterations: compareAnalysis.compareIterations,
      compare_post_read_commands: compareAnalysis.comparePostReadCommands,
      download_no_denied: !denied,
      download_correct_skill: activateReport || prepareTool,
      download_no_export_for_md: !activateExportWrong,
      download_no_bash_fallback: !bashFallback,
      download_has_r7_task: hasR7Task,
    },
    download_content_tail: downloadContent.slice(-500),
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
