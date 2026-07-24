"use strict";

/**
 * Smoke: r7-compare-docs agent with disk-ref payload (document_id + r7-disk:{id}).
 *
 *   node cases/r7-compare-docs/smoke_agent_disk_ref.js --check-payload
 *   R7_HOST_DOCUMENT_ID=12345 node cases/r7-compare-docs/smoke_agent_disk_ref.js
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const AGENT_ID = process.env.LC_AGENT_ID || "8UrXveY9LqY8gSmHl2OpM";
const HOST_DOC_ID = Number(process.env.R7_HOST_DOCUMENT_ID || 0);
const HOST_FILE_NAME = process.env.R7_HOST_FILE_NAME || "smoke-host.docx";

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

function buildDiskRefPayload(documentId, fileName) {
  const content =
    "привет\n\n[Контекст R7: диск]\n" +
    `document_id: ${documentId}\n` +
    `file_name: ${fileName}\n`;
  const files = [
    {
      file_id: `r7-disk:${documentId}`,
      file_name: fileName,
      mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
  ];
  return { content, files };
}

function checkPayloadShape() {
  const payload = buildDiskRefPayload(12345, "test.docx");
  if (!payload.content.includes("document_id: 12345")) {
    throw new Error("payload missing document_id in supplement");
  }
  if (!payload.files[0].file_id.startsWith("r7-disk:")) {
    throw new Error("payload file_id must be r7-disk:{id}");
  }
  if (payload.files[0].file_id.includes("by-name")) {
    throw new Error("payload must not use r7-disk-by-name");
  }
  const instruction = fs.readFileSync(path.join(__dirname, "agent", "instruction"), "utf8");
  if (!instruction.includes("r7-disk-by-name")) {
    throw new Error("instruction missing gate for r7-disk-by-name");
  }
  if (!instruction.includes("host_document_id")) {
    throw new Error("instruction missing host_document_id");
  }
  console.log("OK: disk-ref payload shape + agent instruction gates");
}

function extractToolParams(call) {
  if (!call || typeof call !== "object") return {};
  const direct = call.arguments || call.input || call.params;
  if (direct && typeof direct === "object") return direct;
  if (typeof direct === "string") {
    try {
      return JSON.parse(direct);
    } catch {
      return {};
    }
  }
  const req = call.request;
  if (req && typeof req === "object") {
    return req.arguments || req.input || req.params || {};
  }
  return {};
}

function findToolCall(history, toolName) {
  const rows = history.data || history || [];
  for (const msg of rows) {
    const calls = msg.tool_calls || msg.toolCalls || [];
    for (const call of calls) {
      const name = call.name || call.tool_name || call.command;
      if (name === toolName) return call;
    }
  }
  return null;
}

async function runLive() {
  if (!HOST_DOC_ID) {
    console.error("Set R7_HOST_DOCUMENT_ID to a real document on your R7-Disk account");
    process.exit(2);
  }

  const token = await login();
  const sid = await api(token, "POST", "/v1/agent/session", { agent_id: AGENT_ID });
  if (!sid || !sid.session_id) throw new Error("no session_id");

  const payload = buildDiskRefPayload(HOST_DOC_ID, HOST_FILE_NAME);
  await api(token, "POST", `/v1/agent/session/${sid.session_id}/message`, {
    content: payload.content,
    assistant_mode: "execution",
    mentioned: { files: payload.files },
  });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let history = null;
  for (let i = 0; i < 60; i += 1) {
    await sleep(5000);
    history = await api(token, "GET", `/v1/agent/session/${sid.session_id}/history?page=1&size=99999`);
    if (findToolCall(history, "r7_list_disk_templates")) break;
  }

  const listCall = findToolCall(history, "r7_list_disk_templates");
  if (!listCall) {
    console.error(JSON.stringify(history, null, 2));
    throw new Error("r7_list_disk_templates not called within timeout");
  }

  const params = extractToolParams(listCall);
  const gotId = Number(params.host_document_id);
  if (gotId !== HOST_DOC_ID) {
    console.error("tool call:", JSON.stringify(listCall, null, 2));
    throw new Error(
      "host_document_id mismatch: got " + params.host_document_id + ", expected " + HOST_DOC_ID
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        session_id: sid.session_id,
        host_document_id: params.host_document_id,
        tool_result: listCall.result || null,
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
