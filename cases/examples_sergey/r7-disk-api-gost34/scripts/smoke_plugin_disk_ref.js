#!/usr/bin/env node
"use strict";
/** Smoke: plugin disk-ref payload → R7 ГОСТ34 agent. */
const path = require("path");

const AGENT_ID = process.env.LC_AGENT_ID || "H3ELtOY2uyYcFQwCAgMst";
const DOC_ID = process.env.SMOKE_DOC_ID || "12345";
const DOC_NAME = process.env.SMOKE_DOC_NAME || "task_input.docx";

async function main() {
  const fs = require("fs");
  const envPath = path.resolve(__dirname, "../../../../.env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
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
  const BASE = (process.env.LADCRAFT_API_URL || "https://api.ladcraft.ru").replace(/\/$/, "");
  const unwrap = (d) => (d && typeof d === "object" && d.result !== undefined ? d.result : d);

  async function api(token, method, p, body) {
    const headers = { Authorization: `Bearer ${token}` };
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

  const email = (process.env.LADCRAFT_EMAIL || "").toLowerCase();
  const password = process.env.LADCRAFT_PASSWORD;
  const loginRes = unwrap(
    await api(null, "POST", "/v1/auth/login", { email, password }),
  );
  const token = loginRes.access_token;

  const { session_id: sessionId } = await api(token, "POST", "/v1/agent/session", {
    agent_id: AGENT_ID,
  });

  const content = [
    "Оформи документ по ГОСТ34",
    "",
    "[Контекст R7: диск]",
    `document_id: ${DOC_ID}`,
    `file_name: ${DOC_NAME}`,
  ].join("\n");

  await api(token, "POST", `/v1/agent/session/${sessionId}/message`, {
    content,
    assistant_mode: "execution",
    mentioned: {
      files: [
        {
          file_id: `r7-disk:${DOC_ID}`,
          file_name: DOC_NAME,
          mime_type:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
      ],
    },
  });

  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const act = await api(
      token,
      "GET",
      `/v1/agent/activity?agent_id=${AGENT_ID}&only_active=true`,
    );
    const items = act.items || [];
    const mine = items.find((i) => i.session_id === sessionId);
    if (!mine) break;
    if (mine.activity_state === "requires_user_action") {
      console.log(JSON.stringify({ ok: true, phase: "waiting_user", sessionId }, null, 2));
      process.exit(0);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }

  const hist = await api(token, "GET", `/v1/agent/session/${sessionId}/history?page=1&size=99999`);
  const messages = hist.data || [];
  const toolNames = [];
  for (const m of messages) {
    for (const tc of m.tool_calls || []) {
      if (tc.name) toolNames.push(tc.name);
    }
  }
  const assistantText = messages
    .filter((m) => m.role === "assistant")
    .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
    .join("\n---\n");

  const hasGost34 = toolNames.includes("r7_disk_gost34_generate");
  const hasLogin = toolNames.includes("r7_disk_login");
  const ok = hasGost34 || hasLogin || /gost34|r7_disk|р7-диск|навык/i.test(assistantText);

  console.log(
    JSON.stringify(
      {
        ok,
        agent_id: AGENT_ID,
        session_id: sessionId,
        tool_calls: toolNames,
        assistant_preview: assistantText.slice(0, 800),
      },
      null,
      2,
    ),
  );
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e.message, e.data ? JSON.stringify(e.data, null, 2) : "");
  process.exit(1);
});
