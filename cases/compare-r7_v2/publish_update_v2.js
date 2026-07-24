"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const CASE = __dirname;
const HELPER = path.join(ROOT, ".cursor", "skills", "ladcraft-prod-publish", "scripts", "ladcraft_prod.js");

const SKILL_MAP = [
  { payload: "r7-compare-toolkit.json", slug: "r7-compare-toolkit-v2", skillDir: "r7-compare-toolkit" },
  { payload: "doc-compare.json", slug: "doc-compare-v2", skillDir: "doc-compare" },
  { payload: "r7-docx-render.json", slug: "r7-docx-render-v2", skillDir: "r7-docx-render" },
];

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

function toApiPayload(raw, slug) {
  const body =
    typeof raw.skill === "string" && raw.skill.includes("\n") ? raw.skill : raw.detailed_description || "";
  return {
    skill: slug,
    title: slug,
    name: slug,
    description: raw.description || slug,
    detailed_description: body,
    tags: raw.tags || [],
    category: raw.category || "productivity",
    icon: raw.icon || "document",
    version: raw.version || "1.0.0",
    tools: (raw.tools || []).map(normalizeToolCapabilities),
  };
}

function readAgentMeta() {
  const p = path.join(CASE, "agent", ".from-server.json");
  if (!fs.existsSync(p)) throw new Error("missing agent/.from-server.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function readSkillAppId(skillDir) {
  const p = path.join(CASE, "skills", skillDir, ".from-server.json");
  if (!fs.existsSync(p)) throw new Error("missing .from-server.json for " + skillDir);
  const data = JSON.parse(fs.readFileSync(p, "utf8"));
  if (!data.app_id) throw new Error("no app_id in " + skillDir);
  return data;
}

function mergeToolIds(payload, remoteTools) {
  const byName = Object.fromEntries((remoteTools || []).map((t) => [t.name, t.id]));
  for (const tool of payload.tools || []) {
    if (byName[tool.name]) tool.id = byName[tool.name];
  }
  return payload;
}

function updateSkill(appId, apiPayload) {
  const remoteWrap = prod(`req GET "/v1/application/${appId}?type=skill&return_installed=true"`);
  const remote = remoteWrap.data || remoteWrap;
  mergeToolIds(apiPayload, remote.tools);
  const tmp = path.join(CASE, "payloads", apiPayload.skill + ".merged.json");
  fs.writeFileSync(tmp, JSON.stringify(apiPayload, null, 2));
  const result = prod(`skill-update ${appId} "${tmp.replace(/\\/g, "/")}"`);
  fs.unlinkSync(tmp);
  return result;
}

function main() {
  const agentMeta = readAgentMeta();
  const agentId = agentMeta.agentId;

  execSync("node build_payload.js r7-compare-toolkit", { cwd: CASE, stdio: "inherit" });
  execSync("node build_payload.js doc-compare", { cwd: CASE, stdio: "inherit" });
  execSync("node build_payload.js r7-docx-render", { cwd: CASE, stdio: "inherit" });

  const skills = {};
  for (const item of SKILL_MAP) {
    const meta = readSkillAppId(item.skillDir);
    const raw = JSON.parse(fs.readFileSync(path.join(CASE, "payloads", item.payload), "utf8"));
    const api = toApiPayload(raw, item.slug);
    const tmp = path.join(CASE, "payloads", item.slug + ".update.json");
    fs.writeFileSync(tmp, JSON.stringify(api, null, 2));

    const result = updateSkill(meta.app_id, api);
    skills[item.slug] = {
      app_id: meta.app_id,
      installed_application_id: meta.installed_application_id,
      version: result.version,
      tools: (raw.tools || []).map((t) => t.name),
    };
    fs.writeFileSync(
      path.join(CASE, "skills", item.skillDir, ".from-server.json"),
      JSON.stringify(
        {
          app_id: meta.app_id,
          installed_application_id: meta.installed_application_id,
          version: result.version,
          updated_at: new Date().toISOString().slice(0, 10),
        },
        null,
        2
      ) + "\n"
    );
    console.log("skill-updated:", item.slug, result.version);
  }

  const instrPath = path.join(CASE, "agent", "instruction");
  prod(`agent-patch ${agentId} --instruction-file "${instrPath.replace(/\\/g, "/")}"`);
  console.log("agent-patched:", agentId);

  agentMeta.skills = skills;
  agentMeta.syncedAt = new Date().toISOString();
  fs.writeFileSync(path.join(CASE, "agent", ".from-server.json"), JSON.stringify(agentMeta, null, 2) + "\n");

  const verify = prod(`agent-get ${agentId}`);
  console.log(
    JSON.stringify(
      {
        ok: true,
        agent_id: agentId,
        title: verify.agent?.title,
        skills: Object.fromEntries(
          SKILL_MAP.map((s) => [s.slug, { catalog: skills[s.slug].app_id, version: skills[s.slug].version }])
        ),
      },
      null,
      2
    )
  );
}

main();
