"use strict";

/**
 * Smoke branch B: list folder CSVs then report (no document_id dependency).
 *   node cases/analytics_csv_select/smoke_folder_report.js
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const AGENT_ID = process.env.LC_AGENT_ID || "MOVc1GIygOzS9kwKHyo04";

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
  if (!email || !password) throw new Error("Missing LADCRAFT_EMAIL or LADCRAFT_PASSWORD");
  const d = await api(null, "POST", "/v1/auth/login", { email, password });
  return d.access_token || d.token;
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
    for (const call of msg.tool_calls || msg.toolCalls || []) {
      const name = call.name || call.tool_name || call.command;
      if (name === toolName) out.push(call);
    }
  }
  return out;
}

async function run() {
  const token = await login();
  const sid = await api(token, "POST", "/v1/agent/session", { agent_id: AGENT_ID });
  const sessionId = sid.session_id;

  await api(token, "POST", `/v1/agent/session/${sessionId}/message`, {
    content: "привет",
    assistant_mode: "execution",
  });
  await new Promise((r) => setTimeout(r, 12000));

  await api(token, "POST", `/v1/agent/session/${sessionId}/message`, {
    content: "Показать другие файлы",
    assistant_mode: "execution",
  });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let history = null;
  let listResult = null;
  for (let i = 0; i < 30; i += 1) {
    await sleep(8000);
    history = await api(token, "GET", `/v1/agent/session/${sessionId}/history?page=1&size=99999`);
    const calls = findToolCalls(history, "analytics_list_source_files");
    if (calls.length) {
      listResult = parseToolResult(calls[calls.length - 1].result);
      if (listResult && listResult.ok === true && listResult.files && listResult.files.length) break;
    }
  }

  if (!listResult || listResult.ok !== true) {
    console.error(JSON.stringify(listResult, null, 2));
    throw new Error("list tool did not return ok with files");
  }

  const first = listResult.files[0];
  const csvName = first.name || first.csv_name;
  const csvDocId = first.csv_document_id || first.document_id;
  const dirId = listResult.directory_id || first.directory_id;

  await api(token, "POST", `/v1/agent/session/${sessionId}/message`, {
    content: `Сформируй отчёт по файлу ${csvName}`,
    assistant_mode: "execution",
  });

  let reportResult = null;
  for (let i = 0; i < 30; i += 1) {
    await sleep(8000);
    history = await api(token, "GET", `/v1/agent/session/${sessionId}/history?page=1&size=99999`);
    const calls = findToolCalls(history, "analytics_csv_generate_report");
    if (calls.length) {
      reportResult = parseToolResult(calls[calls.length - 1].result);
      if (reportResult) break;
    }
  }

  if (!reportResult || reportResult.ok !== true) {
    console.error("list ok:", { csvName, csvDocId, dirId, files: listResult.files.length });
    throw new Error("report failed: " + JSON.stringify(reportResult));
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        session_id: sessionId,
        list: { directory_id: dirId, csv_name: csvName, csv_document_id: csvDocId },
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

run().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
