"use strict";

const fs = require("fs");
const path = require("path");

function loadDotEnv() {
  const file = path.resolve(".env");
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

async function main() {
  loadDotEnv();
  const BASE = (process.env.LADCRAFT_API_URL || "https://api.ladcraft.ru").replace(
    /\/$/,
    ""
  );
  const login = await fetch(BASE + "/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.LADCRAFT_EMAIL.toLowerCase(),
      password: process.env.LADCRAFT_PASSWORD,
    }),
  });
  const lr = await login.json();
  const unwrapped = lr.result !== undefined ? lr.result : lr;
  const token = unwrapped.access_token || unwrapped.token;
  const sessionId = process.argv[2] || "vn8MNzZGAWdlPXDV1BjPF";
  const listResp = await fetch(
    BASE +
      "/v1/agent/vfs/files?scope=session&session_id=" +
      encodeURIComponent(sessionId) +
      "&page=1&size=100",
    { headers: { Authorization: "Bearer " + token } }
  );
  const listJson = await listResp.json();
  const files = ((listJson.result || listJson).data) || [];
  console.log(
    "files",
    files.map((f) => ({
      id: f.file_id,
      name: f.file_name,
      size: f.size_bytes,
      mime: f.mime_type,
    }))
  );
  const pivot =
    files.find((f) => f.size_bytes === 5538) ||
    files.find((f) => String(f.file_name || "").toLowerCase().includes("r7")) ||
    files.find((f) => String(f.mime_type || "").includes("spreadsheetml"));
  if (!pivot) throw new Error("pivot file not found");
  const r = await fetch(
    BASE +
      "/v1/agent/vfs/files/" +
      pivot.file_id +
      "/download?format=original",
    { headers: { Authorization: "Bearer " + token } }
  );
  const buf = Buffer.from(await r.arrayBuffer());
  const out = path.resolve("cases/excel_pivot_report/downloaded_pivot_r7.xlsx");
  fs.writeFileSync(out, buf);
  console.log(
    JSON.stringify(
      {
        saved: out,
        file_id: pivot.file_id,
        name: pivot.file_name,
        size: buf.length,
        head: buf.slice(0, 4).toString("hex"),
        mime: r.headers.get("content-type"),
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
