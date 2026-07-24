"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const CASE = __dirname;
const HELPER = path.join(ROOT, ".cursor", "skills", "ladcraft-prod-publish", "scripts", "ladcraft_prod.js");

const SLUG = "doc-compare-v2";
const SKILL_DIR = "r7-document-compare";

function prod(cmd) {
  const out = execSync(`node "${HELPER}" ${cmd}`, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
}

function normalizeVfsScope(scope) {
  if (!scope) return "$USER";
  const upper = String(scope).trim().toUpperCase().replace(/^\$/, "");
  if (upper === "SESSION") return "$SESSION";
  if (upper === "USER") return "$USER";
  if (upper === "WORKSPACE") return "$WORKSPACE";
  return String(scope).startsWith("$") ? String(scope) : "$" + upper;
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

function mergeToolIds(payload, remoteTools) {
  const byName = Object.fromEntries((remoteTools || []).map((t) => [t.name, t.id]));
  for (const tool of payload.tools || []) {
    if (byName[tool.name]) tool.id = byName[tool.name];
  }
  return payload;
}

function main() {
  const agentMeta = JSON.parse(fs.readFileSync(path.join(CASE, "agent", ".from-server.json"), "utf8"));
  const skillMeta = JSON.parse(
    fs.readFileSync(path.join(CASE, "skills", SKILL_DIR, ".from-server.json"), "utf8")
  );
  const agentId = agentMeta.agentId;
  const appId = skillMeta.app_id;

  execSync(`node build_payload.js ${SKILL_DIR}`, { cwd: CASE, stdio: "inherit" });

  const raw = JSON.parse(fs.readFileSync(path.join(CASE, "payloads", "r7-document-compare.json"), "utf8"));
  const api = {
    skill: SLUG,
    title: SLUG,
    name: SLUG,
    description: raw.description,
    detailed_description: raw.skill,
    tags: raw.tags || [],
    category: raw.category || "productivity",
    icon: "document",
    version: raw.version,
    tools: (raw.tools || []).map(normalizeToolCapabilities),
  };

  const remoteWrap = prod(`req GET "/v1/application/${appId}?type=skill&return_installed=true"`);
  const remote = remoteWrap.data || remoteWrap;
  mergeToolIds(api, remote.tools);

  const tmp = path.join(CASE, "payloads", "r7-document-compare.merged.json");
  fs.writeFileSync(tmp, JSON.stringify(api, null, 2));
  const skillResult = prod(`skill-update ${appId} "${tmp.replace(/\\/g, "/")}"`);
  fs.unlinkSync(tmp);

  skillMeta.version = skillResult.version;
  skillMeta.updated_at = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(
    path.join(CASE, "skills", SKILL_DIR, ".from-server.json"),
    JSON.stringify(skillMeta, null, 2) + "\n"
  );

  const instrPath = path.join(CASE, "agent", "instruction");
  prod(`agent-patch ${agentId} --instruction-file "${instrPath.replace(/\\/g, "/")}"`);

  try {
    prod(`agent-bind ${agentId} ${appId} --install`);
  } catch (e) {
    console.warn("agent-bind note:", e.message);
  }

  agentMeta.skills = {
    [SLUG]: {
      app_id: appId,
      installed_application_id: skillMeta.installed_application_id,
      version: skillResult.version,
      tools: (raw.tools || []).map((t) => t.name),
    },
  };
  agentMeta.syncedAt = new Date().toISOString();
  fs.writeFileSync(path.join(CASE, "agent", ".from-server.json"), JSON.stringify(agentMeta, null, 2) + "\n");

  console.log(
    JSON.stringify(
      {
        ok: true,
        agent_id: agentId,
        skill_slug: SLUG,
        app_id: appId,
        published_version: skillResult.version,
        tools: (raw.tools || []).map((t) => t.name),
      },
      null,
      2
    )
  );
}

main();
