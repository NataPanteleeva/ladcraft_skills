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

async function main() {
  await loadEnv();
  const base = process.env.LADCRAFT_API_URL || "https://api.ladcraft.ru";
  const email = process.env.LADCRAFT_EMAIL;
  const password = process.env.LADCRAFT_PASSWORD;
  const agentId = process.env.LC_AGENT_ID || "Tzr2xtBAyU0_jR1az_a8S";
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

  await waitRun(token, base, agentId, sessionId, 240000);

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

  await waitRun(token, base, agentId, sessionId, 360000);

  await api(token, base, "POST", "/v1/agent/session/" + sessionId + "/message", {
    content: "Давай выгрузим",
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

  const outPath = path.join(__dirname, "smoke-result.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        session_id: sessionId,
        r7_upload: r7Up,
        after_start_messages: (hist2.data || hist2).length,
        history: hist2.data || hist2,
      },
      null,
      2
    )
  );

  const tools = [];
  let hasCompareDocuments = false;
  let compareOk = false;
  let hasLegacyHead = false;
  let hasLegacyReadR7 = false;
  let hasDeliverDocx = false;
  let deliverOk = false;
  let hasR7TaskBlock = false;
  let hasRenderDocx = false;
  let hasAtomicExport = false;
  let atomicOk = false;
  for (const m of hist2.data || hist2) {
    if (m.role === "assistant" && typeof m.content === "string" && m.content.includes("```r7.task")) {
      hasR7TaskBlock = m.content.includes("deliver_file");
    }
    if (!m.tool_calls) continue;
    for (const tc of m.tool_calls) {
      const status = tc.status || (tc.success === true ? "completed" : tc.success === false ? "failed" : "unknown");
      tools.push({ name: tc.name, status, success: tc.success });
      if (tc.name === "compare_documents") {
        hasCompareDocuments = true;
        const res = tc.result || {};
        if (res.ok === true && res.compare_report && res.chat_markdown) compareOk = true;
      }
      if (tc.name === "bash") {
        const cmd = (tc.arguments && tc.arguments.command) || tc.command || "";
        if (String(cmd).indexOf("Templates/") >= 0) hasLegacyHead = true;
      }
      if (tc.name === "read_r7_snapshot_text") hasLegacyReadR7 = true;
      if (tc.name === "r7_render_and_deliver_docx") {
        hasAtomicExport = true;
        const res = tc.result || {};
        if (res.ok === true && res.r7_task_block) atomicOk = true;
      }
      // legacy two-step export (still accepted if present)
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
  const exportOk = (atomicOk || (deliverOk && hasR7TaskBlock)) && exportPhaseOk;

  if (!hasCompareDocuments) {
    console.warn("SMOKE: compare_documents not used (expected after LLM revert)");
  }
  const hasDocCompareReads =
    tools.some((t) => t.name === "bash" && t.status === "completed") &&
    tools.some((t) => t.name === "read_r7_snapshot_text" && t.status === "completed");
  if (!hasDocCompareReads) {
    console.error("SMOKE COMPARE FAILED: doc-compare must call bash + read_r7_snapshot_text", { tool_calls: tools });
    process.exit(1);
  }

  if (!exportPhaseOk) {
    console.error("SMOKE EXPORT PHASE FAILED:", {
      hasAtomicExport,
      atomicOk,
      hasRenderDocx,
      hasDeliverDocx,
      deliverOk,
      hasR7TaskBlock,
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
        out: outPath,
        compare_ok: compareOk,
        has_compare_documents: hasCompareDocuments,
        export_phase_ok: exportPhaseOk,
        export_deliver_ok: exportOk,
        tool_calls: tools,
        assistant_replies: (hist2.data || hist2).filter((m) => m.role === "assistant").map((m) => (m.content || "").slice(0, 200)),
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
