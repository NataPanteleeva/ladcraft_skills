"use strict";

/**
 * Smoke: analytics_csv_select — list + report for current document (document_id-first).
 *
 *   node cases/analytics_csv_select/smoke_document_report.js --check-payload
 *   R7_HOST_DOCUMENT_ID=176 R7_HOST_FILE_NAME=data.csv node cases/analytics_csv_select/smoke_document_report.js
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const AGENT_ID = process.env.LC_AGENT_ID || "MOVc1GIygOzS9kwKHyo04";
const HOST_DOC_ID = Number(process.env.R7_HOST_DOCUMENT_ID || 176);
const HOST_FILE_NAME = process.env.R7_HOST_FILE_NAME || "data.csv";

function loadDotEnv() {
  const file = process.env.LADCRAFT_ENV_FILE || path.join(ROOT, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

loadDotEnv();
const BASE = (process.env.LADCRAFT_API_URL || "https://api.ladcraft.ru").replace(/\/+$/, "");
const unwrap = (d) => (d && typeof d === "object" && d.result !== undefined ? d.result : d);

async function api(token, method, p, body) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const init = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const r = await fetch(BASE + p, init);
  const data = await r.json();
  if (!r.ok) {
    const e = new Error(`HTTP ${r.status} ${method} ${p}`);
    e.data = data;
    throw e;
  }
  return unwrap(data);
}

async function login() {
  const email = (process.env.LADCRAFT_EMAIL || process.env.LADCRAFT_USERNAME || "").toLowerCase();
  const password = process.env.LADCRAFT_PASSWORD;
  if (!email || !password) throw new Error("Missing LADCRAFT_EMAIL or LADCRAFT_PASSWORD in .env");
  const d = await api(null, "POST", "/v1/auth/login", { email, password });
  const token = d.access_token || d.token;
  if (!token) throw new Error("No access_token");
  return token;
}

function buildDiskRefPayload(documentId, fileName, userText) {
  const content =
    userText +
    "\n\n[Контекст R7: диск]\n" +
    `document_id: ${documentId}\n` +
    `file_name: ${fileName}\n`;
  const files = [
    {
      file_id: `r7-disk:${documentId}`,
      file_name: fileName,
      mime_type: fileName.toLowerCase().endsWith(".csv")
        ? "text/csv"
        : "application/octet-stream",
    },
  ];
  return { content, files };
}

function parseToolResult(result) {
  if (result == null) return null;
  if (typeof result === "object") return result;
  if (typeof result === "string") {
    try {
      return JSON.parse(result);
    } catch {
      return { raw: result };
    }
  }
  return result;
}

function findToolCalls(history, toolName) {
  const rows = history.data || history || [];
  const out = [];
  for (const msg of rows) {
    const calls = msg.tool_calls || msg.toolCalls || [];
    for (const call of calls) {
      const name = call.name || call.tool_name || call.command;
      if (name === toolName) out.push(call);
    }
  }
  return out;
}

function checkPayloadShape() {
  const p = buildDiskRefPayload(176, "data.csv", "привет");
  if (!p.content.includes("document_id: 176")) throw new Error("missing document_id");
  if (!p.files[0].file_id.startsWith("r7-disk:")) throw new Error("bad file_id");
  console.log("OK: disk-ref payload shape");
}

async function waitForTools(token, sessionId, toolNames, maxRounds) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let history = null;
  for (let i = 0; i < maxRounds; i += 1) {
    await sleep(8000);
    history = await api(token, "GET", `/v1/agent/session/${sessionId}/history?page=1&size=99999`);
    const found = {};
    for (const name of toolNames) {
      found[name] = findToolCalls(history, name);
    }
    const allPresent = toolNames.every((n) => found[n].length > 0);
    if (allPresent) return { history, found };
  }
  return { history, found: Object.fromEntries(toolNames.map((n) => [n, findToolCalls(history || {}, n)])) };
}

async function runLive() {
  if (!HOST_DOC_ID) {
    console.error("Set R7_HOST_DOCUMENT_ID");
    process.exit(2);
  }

  const token = await login();
  const sid = await api(token, "POST", "/v1/agent/session", { agent_id: AGENT_ID });
  if (!sid || !sid.session_id) throw new Error("no session_id");
  const sessionId = sid.session_id;

  const greet = buildDiskRefPayload(HOST_DOC_ID, HOST_FILE_NAME, "привет");
  await api(token, "POST", `/v1/agent/session/${sessionId}/message`, {
    content: greet.content,
    assistant_mode: "execution",
    mentioned: { files: greet.files },
  });

  await new Promise((r) => setTimeout(r, 15000));

  const choice = buildDiskRefPayload(
    HOST_DOC_ID,
    HOST_FILE_NAME,
    "Построить отчёт по данному документу"
  );
  await api(token, "POST", `/v1/agent/session/${sessionId}/message`, {
    content: choice.content,
    assistant_mode: "execution",
    mentioned: { files: choice.files },
  });

  const { history, found } = await waitForTools(
    token,
    sessionId,
    ["analytics_list_source_files", "analytics_csv_generate_report"],
    45
  );

  const listCalls = found.analytics_list_source_files || [];
  const reportCalls = found.analytics_csv_generate_report || [];
  if (!listCalls.length) {
    console.error(JSON.stringify(history, null, 2));
    throw new Error("analytics_list_source_files not called");
  }
  if (!reportCalls.length) {
    console.error(JSON.stringify(history, null, 2));
    throw new Error("analytics_csv_generate_report not called");
  }

  const listResult = parseToolResult(listCalls[listCalls.length - 1].result);
  const reportResult = parseToolResult(reportCalls[reportCalls.length - 1].result);

  if (!listResult || listResult.ok !== true) {
    throw new Error("list tool failed: " + JSON.stringify(listResult));
  }
  if (!reportResult || reportResult.ok !== true) {
    throw new Error("report tool failed: " + JSON.stringify(reportResult));
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        session_id: sessionId,
        document_id: HOST_DOC_ID,
        list: {
          current_file_is_csv: listResult.current_file_is_csv,
          csv_document_id: listResult.csv_document_id,
          csv_name: listResult.csv_name,
        },
        report: {
          output_name: reportResult.output_name,
          directory_id: reportResult.directory_id,
          web_ui_url: reportResult.web_ui_url,
        },
      },
      null,
      2
    )
  );
}

async function main() {
  checkPayloadShape();
  if (process.argv.includes("--check-payload")) return;
  await runLive();
}

main().catch((err) => {
  console.error(err.message || err);
  if (err.data) console.error(JSON.stringify(err.data, null, 2));
  process.exit(1);
});
