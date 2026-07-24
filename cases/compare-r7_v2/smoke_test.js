"use strict";

const fs = require("fs");
const path = require("path");
const {
  assertCompareTransport,
  assertClosingPhrases,
  assertExportTransport,
  collectCompareTurnToolBatches,
  collectCompareTurnToolCalls,
  collectTurnAssistantText,
  findNthUserIndex,
  waitForStartTurnComplete,
  waitForCompareTurnComplete,
} = require("./smoke_compare_guard");

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
  const token = data.access_token || data.token;
  if (!token) throw new Error("no token in login response");
  return token;
}

async function api(token, base, method, p, body) {
  const r = await fetch(base + p, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) {
    const e = new Error("HTTP " + r.status + " " + method + " " + p);
    e.data = d;
    throw e;
  }
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

async function uploadWorkspacePath(token, base, workspaceId, vfsPath, localFile) {
  const buf = fs.readFileSync(localFile);
  const fd = new FormData();
  fd.append("scope", "workspace");
  fd.append("workspace_id", workspaceId);
  fd.append("path", vfsPath);
  fd.append("sync", "true");
  fd.append("file", new Blob([buf]), path.basename(localFile));
  const r = await fetch(base + "/v1/agent/vfs/upload", {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
    body: fd,
  });
  const d = await r.json();
  if (!r.ok) throw new Error("workspace upload failed: " + JSON.stringify(d));
  return d.data ?? d;
}

async function waitRun(token, base, agentId, sessionId, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const act = await api(token, base, "GET", "/v1/agent/activity?agent_id=" + agentId + "&only_active=true");
    const items = act.items || [];
    const active = items.some((i) => i.session_id === sessionId);
    if (!active) return { done: true, waited_ms: Date.now() - start };
    await new Promise((r) => setTimeout(r, 8000));
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
  return process.env.LC_AGENT_ID || "jmsA3w36N93R6x6R5KkxR";
}

async function main() {
  await loadEnv();
  const base = process.env.LADCRAFT_API_URL || "https://api.ladcraft.ru";
  const email = process.env.LADCRAFT_EMAIL;
  const password = process.env.LADCRAFT_PASSWORD;
  const agentId = readAgentId();
  const token = await login(base, email, password);

  const agent = await api(token, base, "GET", "/v1/agent/" + agentId);
  const workspaceId = agent.primary_workspace_id;

  const session = await api(token, base, "POST", "/v1/agent/session", { agent_id: agentId });
  const sessionId = session.session_id;

  const r7Path = "/r7/r7-word_smoketest.json";
  const bashPath = "/session/r7/r7-word_smoketest.json";
  const r7Local = path.join(__dirname, "fixtures", "r7-word_smoketest.json");
  const tplLocal = path.join(__dirname, "..", "doc_compare", "workspace", "Templates", "dogovor_postavki.md");

  const r7Up = await uploadSessionPath(token, base, sessionId, r7Path, r7Local);
  await uploadWorkspacePath(token, base, workspaceId, "Templates/dogovor_postavki.md", tplLocal);

  const title = "R7: word:smoketest::agent:" + agentId;
  await api(token, base, "PATCH", "/v1/agent/session/" + sessionId, { title }).catch(() => {});

  let r7FileId = r7Up.file_id;

  const msg1 = "Привет";
  await api(token, base, "POST", "/v1/agent/session/" + sessionId + "/message", {
    content: msg1,
    assistant_mode: "execution",
    mentioned: {
      files: [
        {
          file_id: r7FileId,
          file_name: bashPath,
          mime_type: "application/json",
        },
      ],
    },
  });

  const startWait = await waitForStartTurnComplete(token, base, sessionId, 240000);
  if (!startWait.ok) {
    console.error("SMOKE START FAILED: start turn did not complete", startWait);
    process.exit(1);
  }

  await api(token, base, "POST", "/v1/agent/session/" + sessionId + "/message", {
    content: "dogovor_postavki.md",
    assistant_mode: "execution",
    mentioned: {
      files: [
        {
          file_id: r7FileId,
          file_name: bashPath,
          mime_type: "application/json",
        },
      ],
    },
  });

  const compareWait = await waitForCompareTurnComplete(token, base, sessionId, 2, 480000);
  if (!compareWait.ok) {
    const failPath = path.join(__dirname, "smoke-compare-wait-fail.json");
    fs.writeFileSync(
      failPath,
      JSON.stringify({ compareWait, history: compareWait.history }, null, 2)
    );
    console.error("SMOKE COMPARE FAILED: compare turn did not complete before export", {
      compareWait,
      tail: (compareWait.text || "").slice(-500),
    });
    process.exit(1);
  }

  await api(token, base, "POST", "/v1/agent/session/" + sessionId + "/message", {
    content: "скачать docx",
    assistant_mode: "execution",
    mentioned: {
      files: [
        {
          file_id: r7FileId,
          file_name: bashPath,
          mime_type: "application/json",
        },
      ],
    },
  });

  await waitRun(token, base, agentId, sessionId, 360000);

  const hist2 = await api(token, base, "GET", "/v1/agent/session/" + sessionId + "/history?page=1&size=99999");
  const history = hist2.data || hist2;

  const compareUserIdx = findNthUserIndex(history, 2);
  const compareTurnBatches =
    compareUserIdx >= 0 ? collectCompareTurnToolBatches(history, compareUserIdx) : [];
  const compareTurnCalls =
    compareUserIdx >= 0 ? collectCompareTurnToolCalls(history, compareUserIdx) : [];
  const compareTransport = assertCompareTransport(compareTurnCalls, compareTurnBatches);
  const compareAssistantText =
    compareUserIdx >= 0 ? collectTurnAssistantText(history, compareUserIdx) : "";
  const closingPhrases = assertClosingPhrases(compareAssistantText);

  const exportUserIdx = findNthUserIndex(history, 3);
  const exportTurnCalls =
    exportUserIdx >= 0 ? collectCompareTurnToolCalls(history, exportUserIdx) : [];
  const exportTransport = assertExportTransport(exportTurnCalls);

  const outPath = path.join(__dirname, "smoke-result.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        session_id: sessionId,
        r7_upload: r7Up,
        after_start_messages: history.length,
        history,
        compare_transport: compareTransport,
        closing_phrases: closingPhrases,
        export_transport: exportTransport,
      },
      null,
      2
    )
  );

  const tools = [];
  let hasCompareDocuments = false;
  let hasLegacyReadR7 = false;
  let hasForbiddenPython = false;
  let hasDeliverDocx = false;
  let deliverOk = false;
  let hasCompareR7Task = false;
  let hasExportR7Task = false;
  let hasRenderDocx = false;
  let hasAtomicExport = false;
  let atomicOk = false;
  let bashTemplateHead = compareTransport.bashTemplateHead;
  let bashSessionHead = compareTransport.bashSessionHead;
  let bashPeekStart = false;

  for (const m of history) {
    if (m.role === "assistant" && typeof m.content === "string") {
      if (m.content.includes("```r7.task")) {
        if (m.content.includes("compare-report.json") || m.content.includes("doc-compare/v1")) {
          hasCompareR7Task = true;
        }
        if (m.content.includes("deliver_file")) hasExportR7Task = true;
      }
    }
    if (!m.tool_calls) continue;
    for (const tc of m.tool_calls) {
      const status = tc.status || (tc.success === true ? "completed" : tc.success === false ? "failed" : "unknown");
      const cmd = (tc.arguments && tc.arguments.command) || tc.command || "";
      tools.push({ name: tc.name, status, command: String(cmd).slice(0, 120) });
      if (tc.name === "compare_documents") hasCompareDocuments = true;
      if (tc.name === "read_r7_snapshot_text" || tc.name === "startup_compare") hasLegacyReadR7 = true;
      if (tc.name === "bash") {
        const c = String(cmd);
        if (c.includes("Templates/") && c.includes("head")) bashTemplateHead = true;
        if (c.includes("/session/r7/") && c.includes("head")) {
          if (c.includes("8000")) bashPeekStart = true;
          else bashSessionHead = true;
        }
        if (/python|<<'PY'/.test(c)) hasForbiddenPython = true;
      }
      if (tc.name === "r7_render_and_deliver_docx") {
        hasAtomicExport = true;
        const res = tc.result || {};
        if (res.ok === true && res.r7_task_block) atomicOk = true;
      }
      if (tc.name === "r7_render_docx" && (status === "completed" || tc.success === true)) {
        const res = tc.result || {};
        if (res.ok !== false) hasRenderDocx = true;
      }
      if (tc.name === "r7_deliver_docx") {
        hasDeliverDocx = true;
        const res = tc.result || {};
        if (res.ok === true && res.r7_task_block) deliverOk = true;
      }
    }
  }

  const legacyExportPhaseOk = hasRenderDocx && hasDeliverDocx;
  const exportPhaseOk = hasAtomicExport || legacyExportPhaseOk;
  const exportOk = atomicOk || (deliverOk && hasExportR7Task);

  const hasBashCompareReads = bashTemplateHead && bashSessionHead;

  const compareTransportSoftOk =
    compareTransport.bashTemplateHead &&
    compareTransport.bashSessionHead &&
    compareTransport.bashCount <= 2 &&
    hasCompareR7Task &&
    closingPhrases.ok;

  if (!compareTransport.ok && !compareTransportSoftOk) {
    console.error("SMOKE COMPARE FAILED: transport guard (ADR-006)", {
      compareTransport,
      compare_turn_tools: compareTurnCalls.map((tc) => ({
        name: tc.name,
        command: String((tc.arguments && tc.arguments.command) || tc.command || "").slice(0, 120),
      })),
    });
    process.exit(1);
  }

  if (hasLegacyReadR7 || hasCompareDocuments || hasForbiddenPython) {
    console.error("SMOKE COMPARE FAILED: forbidden tools or python", {
      hasLegacyReadR7,
      hasCompareDocuments,
      hasForbiddenPython,
      tool_calls: tools,
    });
    process.exit(1);
  }
  if (!hasBashCompareReads) {
    console.error("SMOKE COMPARE FAILED: need 2× bash head (Templates + session)", {
      bashTemplateHead,
      bashSessionHead,
      bashPeekStart,
      tool_calls: tools,
    });
    process.exit(1);
  }
  if (!hasCompareR7Task) {
    console.error("SMOKE COMPARE FAILED: missing r7.task CompareReport in assistant content");
    process.exit(1);
  }

  if (!closingPhrases.ok) {
    console.error("SMOKE COMPARE FAILED: intent-gated closing phrases", {
      closingPhrases,
      tail: compareAssistantText.slice(-500),
    });
    process.exit(1);
  }

  if (!exportTransport.ok) {
    console.error("SMOKE EXPORT FAILED: transport guard (ADR-008)", {
      exportTransport,
      export_turn_tools: exportTurnCalls.map((tc) => ({
        name: tc.name,
        command: String((tc.arguments && tc.arguments.command) || tc.command || "").slice(0, 120),
      })),
    });
    process.exit(1);
  }

  if (!exportPhaseOk) {
    console.error("SMOKE EXPORT PHASE FAILED:", {
      hasAtomicExport,
      atomicOk,
      hasRenderDocx,
      hasDeliverDocx,
      deliverOk,
      hasExportR7Task,
    });
    process.exit(1);
  }

  if (!exportOk) {
    console.warn(
      "SMOKE EXPORT: phase OK, deliver_file skipped (headless API often lacks session VFS for skill tools)"
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        session_id: sessionId,
        agent_id: agentId,
        out: outPath,
        has_compare_r7_task: hasCompareR7Task,
        bash_compare_reads: hasBashCompareReads,
        export_phase_ok: exportPhaseOk,
        export_deliver_ok: exportOk,
        tool_calls: tools,
        assistant_replies: history
          .filter((m) => m.role === "assistant")
          .map((m) => (m.content || "").slice(0, 200)),
        compare_transport: compareTransport,
        closing_phrases: closingPhrases,
        export_transport: exportTransport,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error("SMOKE FAILED:", e.message, e.data || "");
  process.exit(1);
});
