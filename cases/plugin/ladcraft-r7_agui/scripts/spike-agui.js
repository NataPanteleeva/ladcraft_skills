/**
 * Spike: AG-UI capabilities + minimal run against current LCA agent.
 * Run from repo root: node cases/plugin/ladcraft-r7_agui/scripts/spike-agui.js
 */
const fs = require("fs");
const path = require("path");

function loadEnv() {
  const envPath = path.join(__dirname, "../../../../.env");
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[m[1].trim()] = v;
  }
}

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function nanoLike(len = 21) {
  const alphabet =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += alphabet[(Math.random() * alphabet.length) | 0];
  }
  return out;
}

async function main() {
  loadEnv();
  const base = (process.env.LADCRAFT_API_URL || "https://api.ladcraft.ru").replace(
    /\/$/,
    "",
  );
  const email = process.env.LADCRAFT_EMAIL;
  const password = process.env.LADCRAFT_PASSWORD;
  if (!email || !password) throw new Error("Missing LADCRAFT_EMAIL/PASSWORD");

  const loginRes = await fetch(`${base}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const loginJson = await loginRes.json();
  if (!loginRes.ok) throw new Error(`login ${loginRes.status}: ${JSON.stringify(loginJson)}`);
  const token = loginJson.result.access_token;

  const capsRes = await fetch(`${base}/v2/agent/capabilities`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const capsText = await capsRes.text();
  console.log("=== capabilities", capsRes.status);
  console.log(capsText.slice(0, 2000));

  const LCA = "f5BwCaKDeDDG71zHJPvid";
  const sessionRes = await fetch(`${base}/v1/agent/session`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ agent_id: LCA, title: "agui-spike" }),
  });
  const sessionJson = await sessionRes.json();
  if (!sessionRes.ok) throw new Error(`session ${sessionRes.status}: ${JSON.stringify(sessionJson)}`);
  const sessionId = sessionJson.session_id || sessionJson.result?.session_id;
  console.log("=== session", sessionId);

  console.log("=== session raw keys", Object.keys(sessionJson), sessionJson.result ? Object.keys(sessionJson.result) : null);

  const idVariants = [
    { runId: nanoLike(), messageId: nanoLike(), label: "nanoid21" },
    { runId: uuid().replace(/-/g, ""), messageId: uuid().replace(/-/g, ""), label: "uuid-nohyphen" },
    { runId: uuid(), messageId: uuid(), label: "uuid" },
    {
      runId: nanoLike(),
      messageId: nanoLike(),
      label: "nanoid+contentParts",
      contentParts: true,
    },
    {
      runId: nanoLike(),
      messageId: nanoLike(),
      label: "snake_case_fields",
      snake: true,
    },
  ];

  let runRes = null;
  let chosen = null;
  for (const v of idVariants) {
    let runBody;
    if (v.snake) {
      runBody = {
        thread_id: sessionId,
        run_id: v.runId,
        messages: [{ id: v.messageId, role: "user", content: "Ответь одним словом: ок" }],
        tools: [],
        context: [],
      };
    } else {
      runBody = {
        threadId: sessionId,
        runId: v.runId,
        messages: [
          {
            id: v.messageId,
            role: "user",
            content: v.contentParts
              ? [{ type: "text", text: "Ответь одним словом: ок" }]
              : "Ответь одним словом: ок",
          },
        ],
        tools: [],
        context: [],
        forwardedProps: { locale: "ru", timezone: "Europe/Moscow", spike: true },
      };
    }
    const res = await fetch(`${base}/v2/agent/run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(runBody),
    });
    const preview = res.ok ? "(stream)" : (await res.text()).slice(0, 300);
    console.log("=== try", v.label, res.status, preview);
    if (res.ok) {
      runRes = res;
      chosen = v;
      break;
    }
  }
  if (!runRes) throw new Error("run failed all id variants");
  console.log("=== chosen", chosen);

  const reader = runRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events = [];
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    while (true) {
      const m = buffer.match(/\r?\n\r?\n/);
      if (!m || m.index === undefined) break;
      const block = buffer.slice(0, m.index);
      buffer = buffer.slice(m.index + m[0].length);
      let eventId = "";
      const dataLines = [];
      for (const line of block.replace(/\r\n/g, "\n").split("\n")) {
        if (line.startsWith("id:")) eventId = line.slice(3).trim();
        if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
      }
      if (!dataLines.length) continue;
      let ev;
      try {
        ev = JSON.parse(dataLines.join("\n"));
      } catch {
        continue;
      }
      events.push({ id: eventId, type: ev.type, name: ev.name });
      if (ev.type === "TEXT_MESSAGE_CONTENT" && ev.delta) text += ev.delta;
      if (ev.type === "CUSTOM" && ev.name === "eai.message.text.replaced") {
        text = String(ev.value?.content ?? text);
      }
      if (ev.type === "RUN_FINISHED" || ev.type === "RUN_ERROR") {
        console.log("=== terminal", ev.type, JSON.stringify(ev).slice(0, 500));
      }
    }
  }

  console.log("=== event types", [...new Set(events.map((e) => e.type + (e.name ? ":" + e.name : "")))]);
  console.log("=== text", text.slice(0, 500));
  console.log("=== event count", events.length);

  const histRes = await fetch(
    `${base}/v1/agent/session/${sessionId}/history?page=1&size=20`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const histJson = await histRes.json();
  const messages = histJson.data || histJson.result?.data || histJson.messages || [];
  const last = [...messages].reverse().find((m) => m.role === "assistant");
  console.log("=== history assistant keys", last ? Object.keys(last) : null);
  console.log(
    "=== history assistant text slice",
    String(last?.content || last?.text || "").slice(0, 300),
  );
  console.log("=== tool_calls", last?.tool_calls ? last.tool_calls.length : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
