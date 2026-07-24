"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const CASE = __dirname;
const ROOT = path.join(CASE, "..", "..");
const HELPER = path.join(ROOT, ".cursor", "skills", "ladcraft-prod-publish", "scripts", "ladcraft_prod.js");
const PAYLOAD_PATH = path.join(CASE, "payloads", "r7-docx-render.json");
const FROM_SERVER = path.join(CASE, "skills", "r7-docx-render", ".from-server.json");

function prod(cmd) {
  const out = execSync(`node "${HELPER}" ${cmd}`, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
}

function normalizeVfsScope(scope) {
  if (!scope || scope === "session" || scope === "$SESSION") return "$USER";
  return scope.startsWith("$") ? scope : "$" + String(scope).toUpperCase();
}

function normalizeToolCapabilities(tool) {
  const required = tool.capabilities?.required;
  if (!Array.isArray(required)) return tool;
  const vfsByScope = new Map();
  const other = [];
  for (const cap of required) {
    if (cap.type !== "vfs") {
      other.push(cap);
      continue;
    }
    const scope = normalizeVfsScope(cap.scope);
    const prev = vfsByScope.get(scope) || { type: "vfs", scope, operations: [] };
    const ops = new Set(prev.operations);
    for (const op of cap.operations || []) ops.add(op);
    vfsByScope.set(scope, { type: "vfs", scope, operations: [...ops] });
  }
  return {
    ...tool,
    capabilities: { required: [...other, ...vfsByScope.values()] },
  };
}

function toApiPayload(raw) {
  const body =
    typeof raw.skill === "string" && raw.skill.includes("\n") ? raw.skill : raw.detailed_description || "";
  return {
    skill: raw.name,
    title: raw.name,
    name: raw.name,
    description: raw.description || raw.name,
    detailed_description: body,
    tags: raw.tags || [],
    category: raw.category || "productivity",
    icon: raw.icon || "document",
    version: raw.version || "1.0.0",
    tools: (raw.tools || []).map(normalizeToolCapabilities),
  };
}

function main() {
  execSync("node build_payload.js r7-docx-render", { cwd: CASE, stdio: "inherit" });
  const raw = JSON.parse(fs.readFileSync(PAYLOAD_PATH, "utf8"));
  const api = toApiPayload(raw);
  const tmp = path.join(CASE, "payloads", "r7-docx-render.api.json");
  fs.writeFileSync(tmp, JSON.stringify(api, null, 2));

  let appId = null;
  if (fs.existsSync(FROM_SERVER)) {
    try {
      appId = JSON.parse(fs.readFileSync(FROM_SERVER, "utf8")).app_id || null;
    } catch {
      appId = null;
    }
  }

  const result = appId
    ? (() => {
        const remote = prod(`skill-get ${appId}`);
        const byName = Object.fromEntries((remote.tools || []).map((t) => [t.name, t.id]));
        for (const tool of api.tools) {
          if (byName[tool.name]) tool.id = byName[tool.name];
        }
        fs.writeFileSync(tmp, JSON.stringify(api, null, 2));
        return prod(`skill-update ${appId} "${tmp.replace(/\\/g, "/")}"`);
      })()
    : prod(`skill-create "${tmp.replace(/\\/g, "/")}"`);

  const id = appId || result.app_id;
  const detail = prod(`skill-get ${id}`);
  let installedId = null;
  try {
    const installed = prod(
      `req GET "/v1/application/${id}?type=skill&return_installed=true"`
    );
    installedId = installed.data?.installed?.id || null;
  } catch {
    const inst = prod(`skill-install ${id}`);
    installedId = inst.installed_application_id || null;
  }

  const meta = {
    app_id: id,
    installed_application_id: installedId,
    version: detail.version || api.version,
    tools: (detail.tools || []).map((t) => t.name),
    updated_at: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(FROM_SERVER), { recursive: true });
  fs.writeFileSync(FROM_SERVER, JSON.stringify(meta, null, 2) + "\n");
  console.log(JSON.stringify({ ok: true, action: appId ? "update" : "create", ...meta }, null, 2));
}

main();
