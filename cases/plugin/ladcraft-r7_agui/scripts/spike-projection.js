/**
 * Discovery: AG-UI run + stream dump + GET /v2/agent/thread/{id}/projection
 * for LCA and Excel Pivot — to see real shapes for buttons/apply (no history canon).
 *
 * From repo root:
 *   node cases/plugin/ladcraft-r7_agui/scripts/spike-projection.js
 *   node cases/plugin/ladcraft-r7_agui/scripts/spike-projection.js --only lca
 *   node cases/plugin/ladcraft-r7_agui/scripts/spike-projection.js --only excel
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../../../..");
const SAMPLES = path.join(
  __dirname,
  "../_future-server-agents/samples",
);
const PROGRESS = path.join(
  __dirname,
  "../_future-server-agents/PROGRESS.md",
);

const AGENTS = {
  lca: {
    id: "f5BwCaKDeDDG71zHJPvid",
    title: "LCA",
    msg:
      "Проверь текст на опечатки и составь таблицу замечаний (было → стало). " +
      "Если нужен proposal — положи его в ответ.",
  },
  excel: {
    id: "UsL7iqdQLBtYpmP0s7dWF",
    title: "Excel Pivot",
    msg:
      "По открытой книге сделай топ-5 строк по числовой колонке (или сводную, если так уместнее). " +
      "В ответе обязательна строка Файл: с путём результата. Не задавай уточняющих вопросов — действуй по умолчанию.",
  },
};

function loadEnv() {
  const envPath = path.join(ROOT, ".env");
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

function nanoLike(len = 21) {
  const alphabet =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += alphabet[(Math.random() * alphabet.length) | 0];
  }
  return out;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function login(base) {
  const res = await fetch(`${base}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.LADCRAFT_EMAIL,
      password: process.env.LADCRAFT_PASSWORD,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`login ${res.status}: ${JSON.stringify(json)}`);
  return json.result.access_token;
}

async function createSession(base, token, agentId, title) {
  const res = await fetch(`${base}/v1/agent/session`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ agent_id: agentId, title }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`session ${res.status}: ${JSON.stringify(json)}`);
  return json.session_id || json.result?.session_id;
}

async function uploadSessionFile(base, token, sessionId, filePath, destName) {
  const buf = fs.readFileSync(filePath);
  const fd = new FormData();
  fd.append("scope", "session");
  fd.append("session_id", sessionId);
  fd.append("sync", "true");
  // Same shape as ladcraft-agent-drive upload (basename on the File part).
  fd.append("file", new Blob([buf]), destName);

  const res = await fetch(`${base}/v1/agent/vfs/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`upload ${res.status}: ${JSON.stringify(json)}`);
  const unwrapped = json.result || json.data || json;
  const fileId = unwrapped.file_id || unwrapped.id || json.file_id;
  if (!fileId) throw new Error(`upload: no file_id in ${JSON.stringify(json).slice(0, 400)}`);
  const fileName =
    unwrapped.file_name ||
    unwrapped.file_path ||
    unwrapped.path ||
    `/session/${destName}`;
  return {
    file_id: String(fileId),
    file_name: String(fileName),
    mime_type: unwrapped.mime_type || "application/octet-stream",
    raw: json,
  };
}

function buildRunBody(sessionId, userText, fileMeta) {
  const runId = nanoLike();
  const messageId = nanoLike();
  const contentParts = [{ type: "text", text: userText }];
  const forwardedProps = {
    locale: "ru",
    timezone: "Europe/Moscow",
    spike: "projection-discovery",
  };

  if (fileMeta) {
    contentParts.push({
      type: "document",
      source: {
        type: "url",
        value: `/v1/agent/vfs/files/${fileMeta.file_id}/download`,
        mimeType: fileMeta.mime_type,
      },
      metadata: {
        file_id: fileMeta.file_id,
        file_name: fileMeta.file_name,
        mime_type: fileMeta.mime_type,
        source: "attached",
        scope: "session",
      },
    });
    forwardedProps.mentioned = {
      files: [
        {
          file_id: fileMeta.file_id,
          file_name: fileMeta.file_name,
          mime_type: fileMeta.mime_type,
        },
      ],
    };
  }

  // Excel/LCA plugins also put workbook_path in content supplement for Cell.
  let content = contentParts;
  if (fileMeta && fileMeta.bash_hint) {
    const textWithCtx =
      userText +
      "\n\n[Контекст R7: workbook]\n" +
      `workbook_path: ${fileMeta.bash_hint}\n`;
    content = [
      { type: "text", text: textWithCtx },
      ...contentParts.slice(1),
    ];
  }

  return {
    threadId: sessionId,
    runId,
    messages: [
      {
        id: messageId,
        role: "user",
        content: content.length === 1 ? userText : content,
      },
    ],
    tools: [],
    context: [],
    forwardedProps,
  };
}

async function readSseStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events = [];
  let lastEventId = "";
  let lastSeq = 0;
  let terminal = null;

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
      let data;
      try {
        data = JSON.parse(dataLines.join("\n"));
      } catch {
        events.push({ id: eventId, parseError: true, raw: dataLines.join("\n") });
        continue;
      }
      if (eventId) {
        lastEventId = eventId;
        const parts = eventId.split(":");
        const seq = Number(parts[parts.length - 1]);
        if (Number.isFinite(seq)) lastSeq = seq;
      }
      events.push({ id: eventId, ...data });
      if (data.type === "RUN_FINISHED" || data.type === "RUN_ERROR") {
        terminal = data;
      }
    }
  }

  return { events, lastEventId, lastSeq, terminal };
}

async function getProjection(base, token, threadId) {
  const res = await fetch(
    `${base}/v2/agent/thread/${encodeURIComponent(threadId)}/projection`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`projection ${res.status} non-json: ${text.slice(0, 300)}`);
  }
  if (!res.ok) {
    throw new Error(`projection ${res.status}: ${text.slice(0, 500)}`);
  }
  return json;
}

async function waitProjection(base, token, threadId, minSeq, attempts = 8) {
  let last = null;
  for (let i = 0; i < attempts; i++) {
    last = await getProjection(base, token, threadId);
    const runs = last.runs || last.result?.runs || [];
    const maxSeq = runs.reduce(
      (acc, r) => Math.max(acc, Number(r.last_applied_seq || 0)),
      0,
    );
    if (!minSeq || maxSeq >= minSeq) return { projection: last, attempt: i + 1, maxSeq };
    await new Promise((r) => setTimeout(r, 800));
  }
  return { projection: last, attempt: attempts, maxSeq: null, stale: true };
}

async function getHistory(base, token, sessionId) {
  const res = await fetch(
    `${base}/v1/agent/session/${sessionId}/history?page=1&size=50`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const json = await res.json();
  if (!res.ok) return { error: json, status: res.status };
  return json;
}

function summarizeEvents(events) {
  const types = {};
  const tools = [];
  const customs = [];
  let text = "";
  for (const ev of events) {
    const key = ev.type + (ev.name ? `:${ev.name}` : "");
    types[key] = (types[key] || 0) + 1;
    if (String(ev.type || "").startsWith("TOOL_CALL")) {
      tools.push({
        type: ev.type,
        toolCallId: ev.toolCallId,
        toolCallName: ev.toolCallName,
        delta: typeof ev.delta === "string" ? ev.delta.slice(0, 200) : ev.delta,
        // RESULT payloads can be large — keep full in stream file, short here
        hasResult: ev.type === "TOOL_CALL_RESULT",
      });
    }
    if (ev.type === "CUSTOM") {
      customs.push({ name: ev.name, valueKeys: ev.value ? Object.keys(ev.value) : [] });
    }
    if (ev.type === "TEXT_MESSAGE_CONTENT" && ev.delta) text += ev.delta;
  }
  return { typeCounts: types, toolEventCount: tools.length, toolsPreview: tools, customs, textPreview: text.slice(0, 800) };
}

function summarizeProjection(proj) {
  const runs = proj.runs || proj.result?.runs || [];
  return runs.map((run) => {
    const p = run.projection || {};
    const tools = p.tools || [];
    return {
      run_id: run.run_id || run.runId,
      last_applied_seq: run.last_applied_seq,
      terminal: p.terminal,
      messageCount: (p.messages || []).length,
      toolCount: tools.length,
      tools: tools.map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        parentMessageId: t.parentMessageId,
        argumentsPreview:
          typeof t.arguments === "string"
            ? t.arguments.slice(0, 300)
            : JSON.stringify(t.arguments || "").slice(0, 300),
        resultPreview: JSON.stringify(t.result ?? null).slice(0, 800),
        resultKeys:
          t.result && typeof t.result === "object" ? Object.keys(t.result) : typeof t.result,
      })),
      messages: (p.messages || []).map((m) => ({
        id: m.id,
        role: m.role,
        hasOrderedBlocks: Array.isArray(m.orderedBlocks),
        orderedBlockKinds: (m.orderedBlocks || []).map((b) => b.type || b.kind || Object.keys(b || {})),
        responseFileReferences: m.responseFileReferences || null,
        contentPreview: JSON.stringify(m).slice(0, 400),
      })),
    };
  });
}

async function runCase(base, token, key, ts) {
  const cfg = AGENTS[key];
  console.log(`\n======== ${cfg.title} (${cfg.id}) ========`);
  const sessionId = await createSession(
    base,
    token,
    cfg.id,
    `projection-spike-${key}-${ts}`,
  );
  console.log("session", sessionId);

  let fileMeta = null;
  if (key === "excel") {
    const xlsx = path.join(
      ROOT,
      "cases/excel_pivot_report/inputs/Продажи_1000.xlsx",
    );
    if (!fs.existsSync(xlsx)) throw new Error(`missing fixture ${xlsx}`);
    const dest = `sales_${ts}.xlsx`;
    const up = await uploadSessionFile(base, token, sessionId, xlsx, dest);
    fileMeta = {
      ...up,
      mime_type:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bash_hint: `/session/r7/${dest}`,
    };
    // Prefer bash path style used by plugin if upload returns path
    if (up.file_name && String(up.file_name).startsWith("/session/")) {
      fileMeta.bash_hint = up.file_name;
      fileMeta.file_name = up.file_name;
    } else {
      fileMeta.file_name = `/session/r7/${dest}`;
      fileMeta.bash_hint = `/session/r7/${dest}`;
    }
    console.log("uploaded", fileMeta.file_id, fileMeta.file_name);
  } else if (key === "lca") {
    const tmp = path.join(SAMPLES, `_lca_fixture_${ts}.txt`);
    fs.mkdirSync(SAMPLES, { recursive: true });
    fs.writeFileSync(
      tmp,
      "Увважаемый коллега!\n\nПросьба подготовить отчёт о проделаной работе к пятнице.\n" +
        "Необхадимо исправить опечатки и прислать результат.\n",
      "utf8",
    );
    const dest = `lca_doc_${ts}.txt`;
    const up = await uploadSessionFile(base, token, sessionId, tmp, dest);
    fileMeta = {
      ...up,
      mime_type: "text/plain",
      file_name: up.file_name?.startsWith("/")
        ? up.file_name
        : `/session/r7/${dest}`,
    };
    console.log("uploaded", fileMeta.file_id, fileMeta.file_name);
  }

  const body = buildRunBody(sessionId, cfg.msg, fileMeta);
  const runRes = await fetch(`${base}/v2/agent/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
  });
  console.log("run status", runRes.status, runRes.headers.get("content-type"));
  if (!runRes.ok) {
    const errText = await runRes.text();
    throw new Error(`run failed ${runRes.status}: ${errText.slice(0, 800)}`);
  }

  const stream = await readSseStream(runRes);
  console.log(
    "stream events",
    stream.events.length,
    "lastSeq",
    stream.lastSeq,
    "terminal",
    stream.terminal?.type,
  );

  const projWait = await waitProjection(
    base,
    token,
    sessionId,
    stream.lastSeq,
  );
  console.log(
    "projection attempt",
    projWait.attempt,
    "maxSeq",
    projWait.maxSeq,
    "stale",
    Boolean(projWait.stale),
  );

  const history = await getHistory(base, token, sessionId);

  const outDir = path.join(SAMPLES, `${key}-${ts}`);
  fs.mkdirSync(outDir, { recursive: true });

  const meta = {
    agent: cfg,
    sessionId,
    runId: body.runId,
    fileMeta: fileMeta
      ? {
          file_id: fileMeta.file_id,
          file_name: fileMeta.file_name,
          mime_type: fileMeta.mime_type,
        }
      : null,
    streamSummary: summarizeEvents(stream.events),
    projectionSummary: summarizeProjection(projWait.projection),
    projectionWait: {
      attempt: projWait.attempt,
      maxSeq: projWait.maxSeq,
      stale: Boolean(projWait.stale),
      streamLastSeq: stream.lastSeq,
    },
    terminal: stream.terminal,
  };

  fs.writeFileSync(
    path.join(outDir, "00-meta.json"),
    JSON.stringify(meta, null, 2),
    "utf8",
  );
  fs.writeFileSync(
    path.join(outDir, "01-stream-events.json"),
    JSON.stringify(stream.events, null, 2),
    "utf8",
  );
  fs.writeFileSync(
    path.join(outDir, "02-projection.json"),
    JSON.stringify(projWait.projection, null, 2),
    "utf8",
  );
  fs.writeFileSync(
    path.join(outDir, "03-history-v1-compare-only.json"),
    JSON.stringify(history, null, 2),
    "utf8",
  );

  console.log("wrote", outDir);
  return { key, outDir, meta };
}

function appendProgress(results) {
  const lines = [
    "",
    `## Прогон ${stamp()}`,
    "",
  ];
  for (const r of results) {
    const ps = r.meta.projectionSummary || [];
    const tools = ps.flatMap((x) => x.tools || []);
    lines.push(`### ${r.key}`);
    lines.push(`- session: \`${r.meta.sessionId}\``);
    lines.push(`- runId: \`${r.meta.runId}\``);
    lines.push(`- samples: \`${path.relative(ROOT, r.outDir).replace(/\\\\/g, "/")}\``);
    lines.push(
      `- stream types: ${Object.keys(r.meta.streamSummary.typeCounts).join(", ")}`,
    );
    lines.push(`- projection tools: ${tools.length}`);
    for (const t of tools) {
      lines.push(
        `  - \`${t.name}\` status=${t.status} resultKeys=${JSON.stringify(t.resultKeys)}`,
      );
    }
    lines.push(
      `- text preview: ${JSON.stringify(r.meta.streamSummary.textPreview.slice(0, 200))}`,
    );
    lines.push("");
  }
  fs.appendFileSync(PROGRESS, lines.join("\n"), "utf8");
}

async function main() {
  loadEnv();
  const only = process.argv.includes("--only")
    ? process.argv[process.argv.indexOf("--only") + 1]
    : null;
  const base = (process.env.LADCRAFT_API_URL || "https://api.ladcraft.ru").replace(
    /\/$/,
    "",
  );
  if (!process.env.LADCRAFT_EMAIL || !process.env.LADCRAFT_PASSWORD) {
    throw new Error("Missing LADCRAFT_EMAIL/PASSWORD in .env");
  }

  fs.mkdirSync(SAMPLES, { recursive: true });
  const token = await login(base);
  const ts = stamp();
  const keys = only ? [only] : ["lca", "excel"];
  for (const k of keys) {
    if (!AGENTS[k]) throw new Error(`unknown --only ${k}`);
  }

  const results = [];
  for (const k of keys) {
    try {
      results.push(await runCase(base, token, k, ts));
    } catch (err) {
      console.error(`CASE ${k} FAILED`, err);
      results.push({
        key: k,
        outDir: null,
        meta: { error: String(err && err.message ? err.message : err) },
      });
      fs.mkdirSync(SAMPLES, { recursive: true });
      fs.writeFileSync(
        path.join(SAMPLES, `${k}-${ts}-ERROR.json`),
        JSON.stringify({ error: String(err), stack: err?.stack }, null, 2),
      );
    }
  }

  appendProgress(results.filter((r) => r.outDir));
  console.log("\nDone. See PROGRESS.md and samples/");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
