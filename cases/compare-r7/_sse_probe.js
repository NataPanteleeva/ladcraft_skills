"use strict";
const fs = require("fs");
const path = require("path");

function loadDotEnv() {
  const file = path.resolve(__dirname, "../../.env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadDotEnv();

const BASE = (process.env.LADCRAFT_API_URL || "https://api.ladcraft.ru").replace(/\/$/, "");
const SID = "JGb4lRRCfRVxcjNpBj8yP";

async function login() {
  const r = await fetch(BASE + "/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.LADCRAFT_EMAIL || process.env.LADCRAFT_USERNAME,
      password: process.env.LADCRAFT_PASSWORD,
    }),
  });
  const j = await r.json();
  const tok = j.access_token || j.result?.access_token || j.data?.access_token;
  if (!tok) throw new Error("login failed: " + JSON.stringify(j).slice(0, 200));
  return tok;
}

async function probeEndpoints(tok) {
  const paths = [
    `/v1/agent/session/${SID}/response/YjjkwCCj1nTGW2y_DkKzX`,
    `/v1/agent/session/${SID}/active-response`,
    `/v1/agent/task/UbJrLLd89LGvgJ1bg8aX1`,
    `/v1/agent/run/3WCJcYeZFV4sCni9jbeu3`,
  ];
  for (const p of paths) {
    const r = await fetch(BASE + p, { headers: { Authorization: "Bearer " + tok } });
    const t = await r.text();
    console.log("PROBE", r.status, p, t.slice(0, 300).replace(/\s+/g, " "));
  }
}

async function ssePeek(tok, ms) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  const r = await fetch(BASE + "/v1/agent/sse/" + SID, {
    headers: { Authorization: "Bearer " + tok, Accept: "text/event-stream" },
    signal: ac.signal,
  });
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const events = [];
  try {
    while (events.length < 40) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = (chunk.match(/^event:\s*(.*)$/m) || [])[1];
        const data = (chunk.match(/^data:\s*([\s\S]*)$/m) || [])[1];
        if (!ev) continue;
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        const type = parsed?.type || ev;
        const inner = parsed?.data?.data || parsed?.data || {};
        const summary = {
          type,
          ts: parsed?.timestamp,
          tool: inner.tool_name,
          state: inner.state || parsed?.data?.state,
          status: inner.status,
        };
        if (type === "tool_call_start" || type === "tool_call_result") {
          summary.tool = inner.tool_name;
          summary.call_id = inner.tool_call_id;
          summary.command = inner.command || inner.arguments?.command;
          if (type === "tool_call_result") {
            const res = inner.result;
            if (typeof res === "object" && res) {
              summary.ok = res.ok;
              summary.reason = res.reason;
              summary.tpl = res.template_chars;
              summary.doc = res.document_chars;
            } else summary.result_len = String(res || "").length;
          }
        }
        events.push(summary);
        console.log("SSE", JSON.stringify(summary));
      }
    }
  } catch (e) {
    if (e.name !== "AbortError") console.log("SSE err", e.message);
  } finally {
    clearTimeout(timer);
  }
  return events;
}

(async () => {
  const tok = await login();
  await probeEndpoints(tok);
  console.log("--- SSE 90s ---");
  await ssePeek(tok, 90000);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
